(() => {
  "use strict";

  const SAVE_KEY = "rabbit-boss-pet-v1";
  const TASK_KEY = "rabbit-boss-work-tasks-v1";
  const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
  const stateDefaults = {
    version: 1,
    hunger: 82,
    mood: 76,
    energy: 68,
    bond: 12,
    coins: 36,
    xp: 16,
    level: 1,
    accessory: "",
    unlocked: ["", "🎀"],
    sleeping: false,
    muted: false,
    lastSeen: Date.now(),
    lastGift: "",
    createdAt: Date.now()
  };

  const images = {
    idle: "./5.jpg",
    happy: "./2.jpg",
    hungry: "./6.jpg",
    eat: "./3.jpg",
    surprise: "./4.jpg",
    angry: "./1.jpg",
    sleep: "./3.jpg"
  };

  const copy = {
    idle: [
      "你终于来啦，今天也一起摸会儿鱼吧！",
      "我在这儿盯着，你放心喝口水。",
      "认真工作五分钟，奖励自己看我十分钟。",
      "今天的胡萝卜，好像格外香。"
    ],
    pet: ["再摸一下，就一下。", "嗯……这个力度还不错。", "本老大批准你继续摸。"],
    feed: ["胡萝卜！你很懂事嘛。", "咔嚓咔嚓……满分！", "吃饱了，心情也变好啦。"],
    play: ["抓不到我，嘿嘿！", "再来一局！我还没认真呢。", "这一跳，至少值三个胡萝卜。"],
    sleep: ["困了……替我看着点老板。", "呼……胡萝卜山……", "先睡一会儿，醒来继续陪你。"],
    poor: ["肚子咕咕叫了……", "本老大需要一点关注。", "今天是不是忘记陪我啦？"]
  };

  let state = loadState();
  let toastTimer = 0;
  let restoreImageTimer = 0;
  let audioContext = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (value) => Math.max(0, Math.min(100, value));
  const dateKey = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const els = {
    game: $("#game"),
    boss: $("#boss-mode"),
    image: $("#pet-image"),
    stage: $("#pet-stage"),
    speech: $("#speech"),
    reaction: $("#reaction"),
    accessory: $("#accessory"),
    saveStatus: $("#save-status"),
    toast: $("#toast")
  };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
      return parsed && parsed.version === 1 ? { ...stateDefaults, ...parsed } : { ...stateDefaults };
    } catch {
      return { ...stateDefaults };
    }
  }

  function applyOfflineProgress() {
    const now = Date.now();
    const elapsed = Math.min(Math.max(0, now - state.lastSeen), OFFLINE_CAP_MS);
    const hours = elapsed / 3600000;
    if (state.sleeping) {
      state.energy = clamp(state.energy + hours * 12);
      state.hunger = clamp(state.hunger - hours * 3);
    } else {
      state.hunger = clamp(state.hunger - hours * 5);
      state.mood = clamp(state.mood - hours * 2.2);
      state.energy = clamp(state.energy - hours * 3.5);
    }
    state.lastSeen = now;
  }

  function saveState(label = "刚刚自动保存") {
    state.lastSeen = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    els.saveStatus.textContent = label;
    window.setTimeout(() => { els.saveStatus.textContent = "已开启本地自动保存"; }, 1800);
  }

  function changeStat(key, delta) {
    state[key] = clamp(state[key] + delta);
  }

  function gainXp(amount) {
    state.xp += amount;
    while (state.xp >= state.level * 100) {
      state.xp -= state.level * 100;
      state.level += 1;
      state.coins += 20;
      showToast(`升级啦！现在是 LV.${state.level}，奖励 20 胡萝卜币`);
      popReaction("✨");
    }
  }

  function render() {
    const stats = ["hunger", "mood", "energy", "bond"];
    stats.forEach((key) => {
      $(`#${key}-value`).textContent = Math.round(state[key]);
      $(`#${key}-bar`).style.width = `${state[key]}%`;
    });
    $("#coins").textContent = state.coins;
    $("#level").textContent = state.level;
    $("#xp-bar").style.width = `${Math.min(100, state.xp / (state.level * 100) * 100)}%`;
    els.accessory.textContent = state.accessory;
    $("#sound-btn").textContent = state.muted ? "🔇" : "🔊";
    $("#sound-btn").setAttribute("aria-label", state.muted ? "开启音效" : "关闭音效");

    const average = (state.hunger + state.mood + state.energy) / 3;
    let title = "元气满满";
    if (state.sleeping) title = "正在做美梦";
    else if (state.hunger < 28) title = "肚子饿了";
    else if (state.energy < 25) title = "有点困困";
    else if (state.mood < 30) title = "需要抱抱";
    else if (average > 86) title = "超级开心";
    $("#mood-title").textContent = title;

    const giftAvailable = state.lastGift !== dateKey();
    $("#gift-btn").disabled = !giftAvailable;
    $("#gift-btn").textContent = giftAvailable ? "每日礼物" : "明天再来";
    els.stage.classList.toggle("sleeping", state.sleeping);
    $$(".closet-item").forEach((button) => {
      const item = button.dataset.accessory || "";
      button.classList.toggle("active", item === state.accessory);
      button.classList.toggle("locked", !state.unlocked.includes(item));
    });
  }

  function setExpression(expression, duration = 1800) {
    clearTimeout(restoreImageTimer);
    els.image.style.opacity = "0.2";
    window.setTimeout(() => {
      els.image.src = images[expression] || images.idle;
      els.image.style.opacity = "1";
    }, 110);
    if (duration > 0 && expression !== "sleep") {
      restoreImageTimer = window.setTimeout(() => setExpression(selectIdleExpression(), 0), duration);
    }
  }

  function selectIdleExpression() {
    if (state.sleeping) return "sleep";
    if (state.hunger < 28) return "hungry";
    if (state.mood < 25) return "angry";
    if (state.energy < 24) return "surprise";
    return "idle";
  }

  function say(message) {
    els.speech.style.opacity = "0";
    els.speech.style.transform = "translateY(5px)";
    window.setTimeout(() => {
      els.speech.textContent = message;
      els.speech.style.opacity = "1";
      els.speech.style.transform = "translateY(0)";
    }, 130);
  }

  function randomCopy(group) {
    const list = copy[group];
    return list[Math.floor(Math.random() * list.length)];
  }

  function animateStage(kind = "bounce") {
    els.stage.classList.remove("bounce", "wiggle");
    void els.stage.offsetWidth;
    els.stage.classList.add(kind);
    window.setTimeout(() => els.stage.classList.remove(kind), 850);
  }

  function popReaction(symbol) {
    els.reaction.textContent = symbol;
    els.reaction.classList.remove("pop");
    void els.reaction.offsetWidth;
    els.reaction.classList.add("pop");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function playTone(frequency = 520, duration = 0.09) {
    if (state.muted) return;
    try {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.055, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch {}
  }

  function interact(action) {
    if (action !== "sleep" && state.sleeping) state.sleeping = false;
    const actions = {
      feed() {
        if (state.coins < 2) return showToast("胡萝卜币不够啦，摸摸或玩耍可以获得");
        state.coins -= 2;
        changeStat("hunger", 18);
        changeStat("mood", 3);
        gainXp(8);
        setExpression("eat");
        say(randomCopy("feed"));
        popReaction("🥕");
        animateStage("wiggle");
        playTone(660);
      },
      pet() {
        changeStat("mood", 12);
        changeStat("bond", 2);
        state.coins += 1;
        gainXp(5);
        setExpression("happy");
        say(randomCopy("pet"));
        popReaction("💗");
        animateStage("wiggle");
        playTone(720);
      },
      play() {
        if (state.energy < 12) return showToast("兔老大太困了，让它先睡会儿吧");
        changeStat("mood", 15);
        changeStat("energy", -10);
        changeStat("hunger", -4);
        changeStat("bond", 4);
        state.coins += 3;
        gainXp(12);
        setExpression("surprise");
        say(randomCopy("play"));
        popReaction("✨");
        animateStage("bounce");
        playTone(780, 0.12);
      },
      sleep() {
        state.sleeping = !state.sleeping;
        setExpression(state.sleeping ? "sleep" : "idle", 0);
        say(state.sleeping ? randomCopy("sleep") : "睡醒啦！现在精神多了。");
        popReaction(state.sleeping ? "💤" : "☀️");
        if (!state.sleeping) changeStat("energy", 15);
        playTone(440);
      }
    };
    actions[action]?.();
    render();
    saveState();
  }

  function toggleBoss(force) {
    const show = typeof force === "boolean" ? force : els.boss.hidden;
    els.game.hidden = show;
    els.boss.hidden = !show;
    document.title = show ? "今日工作台" : "兔老大的摸鱼小窝";
    if (show) saveState("已暂停并保存");
  }

  function exportSave() {
    saveState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `兔老大存档-${dateKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("存档已导出");
  }

  function importSave(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (!imported || imported.version !== 1) throw new Error("invalid");
        state = { ...stateDefaults, ...imported, lastSeen: Date.now() };
        saveState();
        setExpression(selectIdleExpression(), 0);
        render();
        showToast("存档恢复成功");
      } catch {
        showToast("这个存档无法识别");
      }
    };
    reader.readAsText(file);
  }

  function claimGift() {
    if (state.lastGift === dateKey()) return;
    const reward = 12 + Math.floor(Math.random() * 9);
    state.lastGift = dateKey();
    state.coins += reward;
    changeStat("mood", 8);
    gainXp(10);
    say(`今天的礼物是 ${reward} 个胡萝卜币！`);
    popReaction("🎁");
    playTone(860, 0.14);
    render();
    saveState();
  }

  function selectAccessory(button) {
    const accessory = button.dataset.accessory || "";
    const price = Number(button.dataset.price || 0);
    if (!state.unlocked.includes(accessory)) {
      if (state.coins < price) return showToast(`还差 ${price - state.coins} 个胡萝卜币`);
      state.coins -= price;
      state.unlocked.push(accessory);
      showToast(`解锁成功：${accessory}`);
      popReaction("✨");
    }
    state.accessory = accessory;
    render();
    saveState();
  }

  function tick() {
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    $("#work-date").textContent = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    if (!document.hidden && !state.sleeping) {
      changeStat("hunger", -0.018);
      changeStat("energy", -0.009);
      changeStat("mood", -0.004);
    } else if (state.sleeping) {
      changeStat("energy", 0.055);
      changeStat("hunger", -0.008);
    }
    render();
  }

  function initWorkTasks() {
    const list = $("#task-list");
    try {
      const saved = JSON.parse(localStorage.getItem(TASK_KEY));
      if (Array.isArray(saved)) {
        list.innerHTML = "";
        saved.forEach((task) => addTaskRow(task.text, task.done));
      }
    } catch {}
    list.addEventListener("change", saveWorkTasks);
    $("#add-task").addEventListener("click", () => {
      const text = window.prompt("输入新任务：");
      if (text?.trim()) {
        addTaskRow(text.trim(), false);
        saveWorkTasks();
      }
    });
  }

  function addTaskRow(text, done) {
    const li = document.createElement("li");
    const checkbox = document.createElement("input");
    const span = document.createElement("span");
    const em = document.createElement("em");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(done);
    span.textContent = text;
    em.textContent = done ? "已完成" : "今天";
    checkbox.addEventListener("change", () => {
      em.textContent = checkbox.checked ? "已完成" : "今天";
    });
    li.append(checkbox, span, em);
    $("#task-list").append(li);
  }

  function saveWorkTasks() {
    const tasks = $$("#task-list li").map((item) => ({
      text: item.querySelector("span").textContent,
      done: item.querySelector("input").checked
    }));
    localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
  }

  function bindEvents() {
    $$(".action").forEach((button) => button.addEventListener("click", () => interact(button.dataset.action)));
    els.stage.addEventListener("click", () => interact("pet"));
    $("#gift-btn").addEventListener("click", claimGift);
    $("#sound-btn").addEventListener("click", () => {
      state.muted = !state.muted;
      render();
      saveState();
    });
    $("#boss-btn").addEventListener("click", () => toggleBoss(true));
    $("#export-btn").addEventListener("click", exportSave);
    $("#import-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) importSave(file);
      event.target.value = "";
    });
    $$(".closet-item").forEach((button) => button.addEventListener("click", () => selectAccessory(button)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        toggleBoss();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) saveState("切到后台，已保存");
    });
    window.addEventListener("beforeunload", () => saveState());
  }

  applyOfflineProgress();
  bindEvents();
  initWorkTasks();
  setExpression(selectIdleExpression(), 0);
  render();
  saveState("欢迎回来，进度已恢复");
  tick();
  window.setInterval(tick, 1000);
  window.setInterval(() => {
    if (!state.sleeping && !document.hidden) say(randomCopy((state.hunger < 28 || state.mood < 28) ? "poor" : "idle"));
  }, 26000);
  window.setInterval(() => saveState(), 30000);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
