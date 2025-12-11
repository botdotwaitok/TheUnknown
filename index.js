import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettings, saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const SCRIPT_ID_PREFIX = "The_Unknown";
const SETTING_KEY = "The_Unknown";

// 1. 默认设置
const defaultSettings = {
    masterEnabled: true, // 总开关
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

// 2. 加载设置
function loadSettings() {
    const stored = extension_settings[SETTING_KEY] || {};
    const merged = {
        ...defaultSettings,
        ...stored,
        user: { ...defaultSettings.user, ...(stored.user || {}) },
        char: { ...defaultSettings.char, ...(stored.char || {}) },
        masterEnabled: typeof stored.masterEnabled === "boolean" ? stored.masterEnabled : defaultSettings.masterEnabled
    };
    extension_settings[SETTING_KEY] = merged;
    return extension_settings[SETTING_KEY];
}

// 正则转义
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 构建替换内容
const IMAGE_STYLE = 'height: 1.3em; width: auto; vertical-align: middle; position: relative; bottom: 0.15em; display: inline-block; margin: 0 2px; border-radius: 2px; cursor: help; object-fit: contain;';
function buildReplacement(rawValue) {
    const value = (rawValue ?? '').toString().trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) {
        return `<img src="${value}" title="$1" alt="icon" style="${IMAGE_STYLE}">`;
    }
    return value;
}

// 3. 核心应用逻辑
function applyMask() {
    const settings = loadSettings();
    const context = getContext();
    const masksActive = settings.masterEnabled; // 读取总开关

    extension_settings.regex = extension_settings.regex || [];
    
    const targets = [
        { key: "user", realName: context.name1 },
        { key: "char", realName: context.name2 }
    ];

    targets.forEach(t => {
        const config = settings[t.key];
        const scriptId = `${SCRIPT_ID_PREFIX}_${t.key}`;
        const replacement = buildReplacement(config.replacement);
        const safeName = escapeRegExp(t.realName);
        
        const existingIndex = extension_settings.regex.findIndex(x => x.id === scriptId);

        // 如果总开关关了，或者功能没开，或者名字为空，就移除脚本
        if (!masksActive || !t.realName || !config.enabled) {
            if (existingIndex !== -1) {
                extension_settings.regex.splice(existingIndex, 1);
            }
            return;
        }

        const regexScript = {
            id: scriptId,
            scriptName: `未知恶物: ${config.label}`,
            findRegex: `/(${safeName})/g`,
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

        if (existingIndex !== -1) {
            extension_settings.regex[existingIndex] = regexScript;
        } else {
            extension_settings.regex.push(regexScript);
        }
    });

    saveSettingsDebounced();
    eventSource.emit(event_types.NOTE_UPDATED);
}

// 4. 构建 UI (双按钮版)
function buildUI() {
    const settings = loadSettings();
    // 临时状态变量，用于记录当前面板上的开关状态
    let tempMasterEnabled = settings.masterEnabled;

    const styleBlock = `
    <style>
        .tu-settings-wrapper { display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
        .tu-card {
            background: var(--smart-theme-bg-transfer, rgba(227, 227, 227, 0.15));
            border: 1px solid var(--smart-theme-border, rgba(255, 255, 255, 0.1));
            border-radius: 8px;
            padding: 12px;
            transition: all 0.2s ease;
        }
        .tu-card:hover { border-color: var(--smart-theme-accent, rgba(255, 255, 255, 0.3)); }
        
        .tu-head-row {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 8px; padding-bottom: 8px;
            border-bottom: 1px dashed var(--smart-theme-border, rgba(255,255,255,0.1));
        }
        .tu-title { font-weight: 700; opacity: 0.9; }

        .tu-input-area {
            width: 100%; font-family: monospace; font-size: 1.3em;
            background: rgba(0, 0, 0, 0.2); border: 1px solid transparent; border-radius: 4px; padding: 8px; box-sizing: border-box;
        }
        .tu-input-area:focus { border-color: var(--smart-theme-accent, #e6e6e6ff); outline: none; }

        /* 通用按钮基础样式 */
        .tu-btn {
            padding: 12px; border-radius: 6px; text-align: center; cursor: pointer;
            font-weight: 700; font-size: 1.05em; margin-top: 5px;
            transition: all 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            display: flex; align-items: center; justify-content: center; gap: 8px;
            user-select: none;
        }
        .tu-btn:active { transform: translateY(2px); box-shadow: 0 1px 2px rgba(0,0,0,0.2); }

        /* 总开关按钮 - 开启状态 */
        .tu-toggle-btn.on {
            background: var(--smart-theme-accent, #4caf50); 
            color: var(--smart-theme-accent-text, #fff);
            border: 1px solid transparent;
        }
        /* 总开关按钮 - 关闭状态 */
        .tu-toggle-btn.off {
            background: rgba(100, 100, 100, 0.3);
            color: var(--smart-theme-body-text, #ccc);
            border: 1px solid var(--smart-theme-border, #555);
        }
        .tu-toggle-btn.off:hover { background: rgba(100, 100, 100, 0.5); }

        /* 保存按钮 (稍微做一点区分，用次级颜色或透明度区分) */
        .tu-save-btn {
            background: var(--smart-theme-body-transfer, rgba(0,0,0,0.2));
            border: 1px solid var(--smart-theme-accent, #4caf50);
            color: var(--smart-theme-body-text, #fff);
        }
        .tu-save-btn:hover {
            background: var(--smart-theme-accent, #4caf50);
            color: var(--smart-theme-accent-text, #fff);
        }

        .tu-hint { font-size: 1em; opacity: 0.5; text-align: center; margin-top: 8px; display: block; }
    </style>
    `;

    const generateCard = (key, title, placeholder) => `
        <div class="tu-card">
            <div class="tu-head-row">
                <span class="tu-title">${title}</span>
                <label class="checkbox_label" title="独立开关">
                    <input type="checkbox" data-key="${key}" class="mask_enable_cb" ${settings[key].enabled ? "checked" : ""} />
                    启用
                </label>
            </div>
            <textarea data-key="${key}" class="text_pole mask_input tu-input-area" rows="1" placeholder="${placeholder}" style="resize:vertical; min-height:36px;">${settings[key].replacement}</textarea>
        </div>
    `;

    const buildReplacementLocal = (val) => {
        if (!val) return "";
        const trimmed = val.trim();
        if (trimmed.toLowerCase().startsWith("http")) {
            return `<img src="${trimmed}" title="$1" alt="icon" style="height: 1.3em; width: auto; vertical-align: middle; position: relative; bottom: 0.15em; display: inline-block; margin: 0 2px; border-radius: 2px; cursor: help; object-fit: contain;">`;
        }
        return trimmed;
    };

    const html = `
    ${styleBlock}
    <div class="name-masker-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🫧 未知恶物打码</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content tu-settings-wrapper">
                
                ${generateCard('user', '{{user}} 替换设置', 'Emoji 或 图片链接')}
                ${generateCard('char', '{{char}} 替换设置', 'Emoji 或 图片链接')}

                <div style="margin-top: 8px;">
                    <div id="mask_master_toggle_btn" class="tu-btn tu-toggle-btn ${tempMasterEnabled ? 'on' : 'off'}">
                        <span class="state-icon">${tempMasterEnabled ? '✅' : '⛔'}</span>
                        <span class="state-text">${tempMasterEnabled ? '总开关：已开启' : '总开关：已关闭'}</span>
                    </div>

                    <div id="mask_save_btn" class="tu-btn tu-save-btn">
                        <span>💾 保存并应用设置</span>
                    </div>
                    
                    <small class="tu-hint">需要刷新才可以生效哦 | 支持 Emoji 与 图片链接</small>
                </div>

            </div>
        </div>
    </div>
    `;

    $("#extensions_settings").append(html);

    // --- 事件绑定 ---

    // 1. 总开关按钮点击逻辑
    const $toggleBtn = $("#mask_master_toggle_btn");
    const $iconSpan = $toggleBtn.find(".state-icon");
    const $textSpan = $toggleBtn.find(".state-text");

    $toggleBtn.click(() => {
        tempMasterEnabled = !tempMasterEnabled; // 切换状态
        
        // 更新按钮视觉
        if (tempMasterEnabled) {
            $toggleBtn.removeClass("off").addClass("on");
            $iconSpan.text("✅");
            $textSpan.text("总开关：已开启");
        } else {
            $toggleBtn.removeClass("on").addClass("off");
            $iconSpan.text("⛔");
            $textSpan.text("总开关：已关闭");
        }
    });

    // 2. 保存按钮点击逻辑
    $("#mask_save_btn").click(() => {
        const settings = loadSettings();
        
        // 保存 User/Char 输入
        $(".mask_enable_cb").each((_, el) => {
            const key = $(el).data("key");
            settings[key].enabled = $(el).is(":checked");
        });
        $(".mask_input").each((_, el) => {
            const key = $(el).data("key");
            settings[key].replacement = buildReplacementLocal($(el).val());
        });

        // 保存总开关状态
        settings.masterEnabled = tempMasterEnabled;

        extension_settings[SETTING_KEY] = settings;
        applyMask();
        toastr.success("打码设置已更新！");
    });
}

// 插件入口
jQuery(async () => {
    const refresh = () => { if(extension_settings[SETTING_KEY]) applyMask(); };
    eventSource.on(event_types.CHARACTER_LOADED, refresh);
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.MESSAGE_RECEIVED, refresh);

    buildUI();
    $("#bubble_floating_toggle").remove();
});
