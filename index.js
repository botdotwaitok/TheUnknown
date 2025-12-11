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

// 加载设置
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

// 正则转义
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 智能检测替换内容
 * 如果输入的是 http/https 链接，自动包裹为 img 标签并添加悬停显示原名的功能
 */
function buildReplacement(val) {
    if (!val) return "";
    const trimmed = val.trim();
    // 检测是否以 http 开头
    if (trimmed.toLowerCase().startsWith("http")) {
        // $1 代表正则捕获到的原名，实现悬停显示
        return `<img src="${trimmed}" title="$1" alt="icon" style="height: 1.3em; width: auto; vertical-align: middle; position: relative; bottom: 0.15em; display: inline-block; margin: 0 2px; border-radius: 2px; cursor: help; object-fit: contain;">`;
    }
    return trimmed;
}

// 核心：生成并注入/更新正则脚本
function applyMask() {
    const settings = loadSettings();
    const context = getContext();
    const masksActive = settings.masterEnabled !== false;

    extension_settings.regex = extension_settings.regex || [];
    
    const targets = [
        { key: "user", realName: context.name1 }, 
        { key: "char", realName: context.name2 }  
    ];

    targets.forEach(t => {
        const config = settings[t.key]; 
        const scriptId = `${SCRIPT_ID_PREFIX}_${t.key}`; 
        
        const existingIndex = extension_settings.regex.findIndex(x => x.id === scriptId);

        if (!masksActive || !t.realName || !config.enabled) {
            if (existingIndex !== -1) {
                extension_settings.regex[existingIndex].disabled = true;
            }
            return;
        }

        // 构造正则脚本
        // 注意：这里改成了 /(${escapeRegExp(t.realName)})/g
        // 增加了括号 () 变成捕获组，这样 replacement 里的 $1 才能获取到原名字
        const regexScript = {
            id: scriptId,
            scriptName: `未知恶物: ${config.label}`, 
            findRegex: `/(${escapeRegExp(t.realName)})/g`, 
            replaceString: config.replacement,
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

        if (existingIndex !== -1) {
            extension_settings.regex[existingIndex] = regexScript;
        } else {
            extension_settings.regex.push(regexScript);
        }
    });

    saveSettingsDebounced();
    eventSource.emit(event_types.NOTE_UPDATED);
    renderFloatingToggle(settings);
}

// 悬浮按钮逻辑
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
        toggleMasks(); 
    });

    $toggle.on("click", (e) => e.preventDefault());
}

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

function toggleMasks(forceState) {
    const settings = loadSettings();
    const nextState = typeof forceState === "boolean" ? forceState : !settings.masterEnabled;
    settings.masterEnabled = nextState;
    extension_settings[SETTING_KEY] = settings;
    applyMask();
    toastr[nextState ? "success" : "info"](nextState ? "打码已开启" : "打码已关闭");
}

function buildUI() {
    const settings = loadSettings();
    
    const generateBlock = (key, title) => `
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 5px; margin-bottom: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <strong>${title}</strong>
                <label class="checkbox_label">
                    <input type="checkbox" data-key="${key}" class="mask_enable_cb" ${settings[key].enabled ? "checked" : ""} />
                    启用
                </label>
            </div>
            <textarea data-key="${key}" class="text_pole mask_input" rows="2" placeholder="输入 Emoji 或 图片链接 (http...)">${settings[key].replacement}</textarea>
        </div>
    `;

    const html = `
    <div class="name-masker-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🫧 打码设置 (Name Masker)</b>
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
                <div id="mask_save_btn" class="menu_button">💾 保存并应用</div>
                <small>输入 http 链接会自动转为图片。支持悬停查看原名。</small>
            </div>
        </div>
    </div>
    `;

    $("#extensions_settings").append(html);

    // 绑定保存按钮事件
    $("#mask_save_btn").click(() => {
        const settings = loadSettings();
        $(".mask_enable_cb").each((_, el) => {
            const key = $(el).data("key");
            settings[key].enabled = $(el).is(":checked");
        });
        $(".mask_input").each((_, el) => {
            const key = $(el).data("key");
            // 这里调用我们新增的 buildReplacement 函数
            settings[key].replacement = buildReplacement($(el).val());
        });
        settings.masterEnabled = $("#mask_master_cb").is(":checked");
        settings.floatingToggle.enabled = $("#mask_floating_enable_cb").is(":checked");
        settings.floatingToggle.icon = $("#mask_floating_icon_input").val() || defaultSettings.floatingToggle.icon;

        extension_settings[SETTING_KEY] = settings;
        applyMask();
        toastr.success("打码设置已更新！");
    });
}

jQuery(async () => {
    const refresh = () => { if(extension_settings[SETTING_KEY]) applyMask(); };
    
    eventSource.on(event_types.CHARACTER_LOADED, refresh);
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.MESSAGE_RECEIVED, refresh); 

    buildUI();
    renderFloatingToggle(loadSettings());
});
