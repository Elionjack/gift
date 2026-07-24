(() => {
  "use strict";

  const SAVE_KEY = "rabbit-boss-pet-v1";
  const TASK_KEY = "rabbit-boss-work-tasks-v1";
  const WORRY_KEY = "rabbit-boss-worries-v1";
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
  let worries = loadWorries();
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
    toast: $("#toast"),
    intro: $("#gift-intro"),
    worryModal: $("#worry-modal"),
    worryText: $("#worry-text"),
    worryList: $("#worry-list")
  };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
      return parsed && parsed.version === 1 ? { ...stateDefaults, ...parsed } : { ...stateDefaults };
    } catch {
      return { ...stateDefaults };
    }
  }

  function loadWorries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORRY_KEY));
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.text === "string") : [];
    } catch {
      return [];
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
    document.title = show ? "今日工作台" : "苳苳的小兔｜摸鱼小窝";
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

  function resetProgress() {
    const confirmed = window.confirm(
      "确定要将养成进度归零吗？\n\n等级、状态、胡萝卜币、装扮和每日礼物记录都会重置；烦恼记录和工作模式里的待办不会删除。"
    );
    if (!confirmed) return;

    localStorage.removeItem(SAVE_KEY);
    state = {
      ...stateDefaults,
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
    clearTimeout(restoreImageTimer);
    setExpression("idle", 0);
    say("重新认识一下吧！今天也请多多关照。");
    render();
    saveState("养成进度已归零");
    popReaction("🌱");
    showToast("养成进度已归零");
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

  function initGiftIntro() {
    const intro = els.intro;
    const caption = $("#intro-caption-text");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timing = reducedMotion
      ? { arrive: 80, rummage: 350, open: 760, title: 1150, leave: 2200 }
      : { arrive: 280, rummage: 1100, open: 2550, title: 3250, leave: 4850 };

    document.body.classList.add("intro-active");
    window.setTimeout(() => intro.classList.add("phase-arrive"), timing.arrive);
    window.setTimeout(() => {
      intro.classList.add("phase-rummage");
      caption.textContent = "小兔正在努力拆开丝带……";
    }, timing.rummage);
    window.setTimeout(() => {
      intro.classList.remove("phase-rummage");
      intro.classList.add("phase-open");
      caption.textContent = "呀，礼物打开啦！";
    }, timing.open);
    window.setTimeout(() => {
      intro.classList.add("phase-title");
      caption.textContent = "欢迎回到苳苳的小兔";
    }, timing.title);
    window.setTimeout(finishGiftIntro, timing.leave);
    $("#intro-skip").addEventListener("click", finishGiftIntro);
  }

  function finishGiftIntro() {
    if (els.intro.hidden || els.intro.classList.contains("leaving")) return;
    els.intro.classList.add("leaving");
    document.body.classList.remove("intro-active");
    window.setTimeout(() => {
      els.intro.hidden = true;
      els.intro.classList.remove("leaving");
    }, 680);
  }

  function saveWorries() {
    localStorage.setItem(WORRY_KEY, JSON.stringify(worries));
  }

  function renderWorries() {
    const countText = `${worries.length} 条`;
    $("#worry-count").textContent = countText;
    $("#worry-total").textContent = `${worries.length} 条记录`;
    els.worryList.replaceChildren();

    if (worries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "worry-empty";
      empty.textContent = "这里还是空的。小兔会安静等你想说的时候。";
      els.worryList.append(empty);
      return;
    }

    const formatter = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    worries.forEach((worry) => {
      const entry = document.createElement("article");
      entry.className = "worry-entry";
      const time = document.createElement("time");
      const text = document.createElement("p");
      const remove = document.createElement("button");
      time.dateTime = new Date(worry.createdAt).toISOString();
      time.textContent = formatter.format(new Date(worry.createdAt));
      text.textContent = worry.text;
      remove.type = "button";
      remove.className = "worry-delete";
      remove.dataset.id = worry.id;
      remove.setAttribute("aria-label", "删除这条烦恼");
      remove.textContent = "×";
      entry.append(time, text, remove);
      els.worryList.append(entry);
    });
  }

  function openWorryModal() {
    els.worryModal.hidden = false;
    document.body.style.overflow = "hidden";
    renderWorries();
    window.setTimeout(() => els.worryText.focus(), 60);
  }

  function closeWorryModal() {
    els.worryModal.hidden = true;
    document.body.style.overflow = "";
  }

  function keepWorry(event) {
    event.preventDefault();
    const text = els.worryText.value.trim();
    if (!text) {
      els.worryText.focus();
      showToast("先把想说的话写下来吧");
      return;
    }

    worries.unshift({
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      createdAt: Date.now()
    });
    worries = worries.slice(0, 200);
    saveWorries();
    els.worryText.value = "";
    $("#worry-length").textContent = "0";
    closeWorryModal();

    const comfort = [
      "我听见了。今天已经很不容易了，先陪你安静一会儿。",
      "这件事一定让你很难受。没关系，我会替你把它好好收着。",
      "谢谢你愿意告诉我。你不用现在就解决所有事情。",
      "先深呼吸一下吧。本老大就在这里，不会笑你的。",
      "你的感受很重要。今天也要对自己温柔一点。"
    ];
    changeStat("bond", 3);
    changeStat("mood", 5);
    gainXp(7);
    setExpression("happy", 3200);
    say(comfort[Math.floor(Math.random() * comfort.length)]);
    popReaction("💗");
    render();
    saveState("烦恼已由小兔保管");
    renderWorries();
    showToast("小兔已经替你记下来了");
  }

  function bindEvents() {
    $$(".action[data-action]").forEach((button) => button.addEventListener("click", () => interact(button.dataset.action)));
    els.stage.addEventListener("click", () => interact("pet"));
    $("#gift-btn").addEventListener("click", claimGift);
    $("#sound-btn").addEventListener("click", () => {
      state.muted = !state.muted;
      render();
      saveState();
    });
    $("#boss-btn").addEventListener("click", () => toggleBoss(true));
    $("#export-btn").addEventListener("click", exportSave);
    $("#reset-btn").addEventListener("click", resetProgress);
    $("#worry-btn").addEventListener("click", openWorryModal);
    $("#worry-close").addEventListener("click", closeWorryModal);
    $("#worry-form").addEventListener("submit", keepWorry);
    els.worryText.addEventListener("input", () => {
      $("#worry-length").textContent = String(els.worryText.value.length);
    });
    els.worryModal.addEventListener("click", (event) => {
      if (event.target === els.worryModal) closeWorryModal();
    });
    els.worryList.addEventListener("click", (event) => {
      const button = event.target.closest(".worry-delete");
      if (!button) return;
      if (!window.confirm("要删掉这条烦恼记录吗？")) return;
      worries = worries.filter((item) => item.id !== button.dataset.id);
      saveWorries();
      renderWorries();
      showToast("这条烦恼已经放下了");
    });
    $("#import-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) importSave(file);
      event.target.value = "";
    });
    $$(".closet-item").forEach((button) => button.addEventListener("click", () => selectAccessory(button)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!els.intro.hidden) {
          finishGiftIntro();
          return;
        }
        if (!els.worryModal.hidden) {
          closeWorryModal();
          return;
        }
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
  renderWorries();
  initGiftIntro();
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
