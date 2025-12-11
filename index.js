import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettings, saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const SCRIPT_ID_PREFIX = "The_Unknown";
const SETTING_KEY = "The_Unknown";
const FLOATING_TOGGLE_ID = "bubble_floating_toggle";

const defaultSettings = {
    masterEnabled: true,
    floatingToggle: {
        enabled: true,
        icon: "🫧",
        left: 20,
        top: 80
    },
    user: {
        enabled: true,
        replacement: "🐰", 
        label: "{{user}}"  
    },
    char: {
        enabled: true,     
        replacement: "🐱", 
        label: "{{char}}"
    }
};

// 加载设置 (为了让你的配置关掉酒馆后还能保存，我们需要读写 extension_settings)
function loadSettings() {
    const stored = extension_settings[SETTING_KEY] || {};
    const merged = {
        ...defaultSettings,
        ...stored,
        user: { ...defaultSettings.user, ...(stored.user || {}) },
        char: { ...defaultSettings.char, ...(stored.char || {}) },
        floatingToggle: { ...defaultSettings.floatingToggle, ...(stored.floatingToggle || {}) },
        masterEnabled: typeof stored.masterEnabled === "boolean" ? stored.masterEnabled : defaultSettings.masterEnabled
    };
    extension_settings[SETTING_KEY] = merged;
    return extension_settings[SETTING_KEY];
}

// 正则转义 (防报错)
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 根据用户输入构造替换内容；http(s) 开头时自动包装为 <img ... title="$1" ...>
const IMAGE_STYLE = 'height: 1.3em; width: auto; vertical-align: middle; position: relative; bottom: 0.15em; display: inline-block; margin: 0 2px; border-radius: 2px; cursor: help; object-fit: contain;';
function buildReplacement(rawValue) {
    const value = (rawValue ?? '').toString().trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) {
        return `<img src="${value}" title="$1" alt="icon" style="${IMAGE_STYLE}">`;
    }
    return value;
}

// 核心：生成并注入/更新正则脚本
function applyMask() {
    const settings = loadSettings();
    const context = getContext();
    const masksActive = settings.masterEnabled !== false;

    // 确保列表存在，避免首次加载时报错 (用全局 regex 列表)
    extension_settings.regex = extension_settings.regex || [];
    
    // 我们定义一个映射关系：配置里的 key -> 酒馆里的真实名字变量
    const targets = [
        { key: "user", realName: context.name1 }, // name1 是用户
        { key: "char", realName: context.name2 }  // name2 是角色
    ];

    targets.forEach(t => {
        const config = settings[t.key]; // 获取对应的配置 (user 或 char)
        const scriptId = `${SCRIPT_ID_PREFIX}_${t.key}`; // 生成唯一ID，例如 plugin_name_masker_user
        const replacement = buildReplacement(config.replacement);
        const safeName = escapeRegExp(t.realName);
        
        // 1. 先在列表里找找看有没有这个脚本
        const existingIndex = extension_settings.regex.findIndex(x => x.id === scriptId);

        // 如果全局关掉、名字为空（没加载角色时）或者功能被禁用
        if (!masksActive || !t.realName || !config.enabled) {
            // 如果脚本存在，就移除，避免切换开关后还在生效
            if (existingIndex !== -1) {
                extension_settings.regex.splice(existingIndex, 1);
            }
            return;
        }

        // 2. 构造正则脚本
        const regexScript = {
            id: scriptId,
            scriptName: `未知恶物: ${config.label}`, // 显示在列表里的名字
            findRegex: `/(${safeName})/g`, // 捕获组用于 $1
            replaceString: replacement,
            trimStrings: [],
            placement: [2], // Markdown Only
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
        };

        // 3. 注入或更新
        if (existingIndex !== -1) {
            extension_settings.regex[existingIndex] = regexScript;
        } else {
            extension_settings.regex.push(regexScript);
        }
    });

    // 保存并刷新界面
    saveSettingsDebounced();
    eventSource.emit(event_types.NOTE_UPDATED);
    renderFloatingToggle(settings);
}

// 悬浮按钮：拖拽 & 点击
function attachFloatingToggleDrag($toggle) {
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;

    const savePosition = () => {
        const settings = loadSettings();
        const left = parseInt($toggle.css("left"), 10);
        const top = parseInt($toggle.css("top"), 10);
        settings.floatingToggle.left = left;
        settings.floatingToggle.top = top;
        extension_settings[SETTING_KEY] = settings;
        saveSettingsDebounced();
    };

    $toggle.on("mousedown", (e) => {
        dragging = true;
        moved = false;
        offsetX = e.clientX - $toggle[0].offsetLeft;
        offsetY = e.clientY - $toggle[0].offsetTop;
        e.preventDefault();
    });

    $(document).off(".maskFloatingToggle");
    $(document).on("mousemove.maskFloatingToggle", (e) => {
        if (!dragging) return;
        moved = true;
        const left = e.clientX - offsetX;
        const top = e.clientY - offsetY;
        $toggle.css({ left, top });
    });

    $(document).on("mouseup.maskFloatingToggle", () => {
        if (!dragging) return;
        dragging = false;
        if (moved) {
            savePosition();
            return;
        }
        toggleMasks(); // 没有拖动，当作点击
    });

    // 防止 click 触发两次 toggle
    $toggle.on("click", (e) => e.preventDefault());
}

// 创建 / 更新悬浮按钮
function renderFloatingToggle(settings = loadSettings()) {
    const floatCfg = settings.floatingToggle || defaultSettings.floatingToggle;
    let $toggle = $(`#${FLOATING_TOGGLE_ID}`);

    if (!floatCfg.enabled) {
        if ($toggle.length) $toggle.remove();
        return;
    }

    if (!$toggle.length) {
        $toggle = $(`
            <div id="${FLOATING_TOGGLE_ID}" title="点击快速开关打码" style="position: fixed; left: ${floatCfg.left}px; top: ${floatCfg.top}px; width: 46px; height: 46px; background: rgba(0,0,0,0.45); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: move; z-index: 9999; box-shadow: 0 6px 18px rgba(0,0,0,0.25); user-select: none;">
                <span class="mask-float-icon"></span>
            </div>
        `);
        $("body").append($toggle);
        attachFloatingToggleDrag($toggle);
    }

    $toggle.find(".mask-float-icon").html(floatCfg.icon || "🎭");
    $toggle.toggleClass("mask-off", !settings.masterEnabled);
    $toggle.css({
        left: floatCfg.left,
        top: floatCfg.top,
        opacity: settings.masterEnabled ? 1 : 0.6
    });
}

// 全局开关（悬浮按钮 & UI 使用）
function toggleMasks(forceState) {
    const settings = loadSettings();
    const nextState = typeof forceState === "boolean" ? forceState : !settings.masterEnabled;
    settings.masterEnabled = nextState;
    extension_settings[SETTING_KEY] = settings;
    applyMask();
    toastr[nextState ? "success" : "info"](nextState ? "打码已开启" : "打码已关闭");
}

// 构建 UI
function buildUI() {
    const settings = loadSettings();
    
    // HTML 模板：循环生成 user 和 char 的设置块
    const generateBlock = (key, title) => `
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 5px; margin-bottom: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <strong>${title}</strong>
                <label class="checkbox_label">
                    <input type="checkbox" data-key="${key}" class="mask_enable_cb" ${settings[key].enabled ? "checked" : ""} />
                    启用
                </label>
            </div>
            <textarea data-key="${key}" class="text_pole mask_input" rows="2" placeholder="输入 Emoji 或 <img src='...' />">${settings[key].replacement}</textarea>
        </div>
    `;

    const html = `
    <div class="name-masker-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🫧 未知恶物打码设置</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                ${generateBlock('user', '{{user}}设置')}
                ${generateBlock('char', '{{char}} 设置')}
                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 5px; margin-bottom: 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <strong>悬浮快速开关</strong>
                        <label class="checkbox_label">
                            <input type="checkbox" id="mask_floating_enable_cb" ${settings.floatingToggle.enabled ? "checked" : ""} />
                            显示按钮
                        </label>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
                        <label class="checkbox_label" style="margin-right:12px;">
                            <input type="checkbox" id="mask_master_cb" ${settings.masterEnabled ? "checked" : ""} />
                            默认开启打码
                        </label>
                        <div style="display:flex; align-items:center; gap:6px; flex:1;">
                            <span style="font-size:12px;">图标内容：</span>
                            <input id="mask_floating_icon_input" class="text_pole" style="flex:1; min-width: 120px;" value="${settings.floatingToggle.icon}" placeholder="输入 Emoji 或 <img />" />
                        </div>
                        <small style="opacity:0.8;">图标可拖动调整位置，点击即可切换开关。</small>
                    </div>
                </div>
<div id="mask_save_btn"
     class="menu_button"
     style="display:flex;align-items:center;gap:6px;writing-mode:horizontal-tb;text-orientation:mixed;">
  <span>💾</span><span>保存并应用</span>
</div>

        </div>
    </div>
    `;

    $("#extensions_settings").append(html);

    // 绑定保存按钮事件
    $("#mask_save_btn").click(() => {
        const settings = loadSettings();
        // 读取 UI 里的值更新到 settings 对象
        $(".mask_enable_cb").each((_, el) => {
            const key = $(el).data("key");
            settings[key].enabled = $(el).is(":checked");
        });
        $(".mask_input").each((_, el) => {
            const key = $(el).data("key");
            // 保存时就做一次智能检测/包装，避免只是保存了链接
            settings[key].replacement = buildReplacement($(el).val());
        });
        settings.masterEnabled = $("#mask_master_cb").is(":checked");
        settings.floatingToggle.enabled = $("#mask_floating_enable_cb").is(":checked");
        settings.floatingToggle.icon = $("#mask_floating_icon_input").val() || defaultSettings.floatingToggle.icon;

        // 保存到 extension_settings 并执行打码
        extension_settings[SETTING_KEY] = settings;
        applyMask();
        toastr.success("打码设置已更新！");
    });
}

// 插件入口
jQuery(async () => {
    // 各种事件监听，确保换人、改名时自动更新正则
    const refresh = () => { if(extension_settings[SETTING_KEY]) applyMask(); };
    
    eventSource.on(event_types.CHARACTER_LOADED, refresh);
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.MESSAGE_RECEIVED, refresh); // 这是一个保险，防止有时候没刷新

    buildUI();
    renderFloatingToggle(loadSettings());
});


