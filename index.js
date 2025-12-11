import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettings, saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const SCRIPT_ID_PREFIX = "The_Unknown";
const SETTING_KEY = "The_Unknown";

// 1. 默认设置：删掉了悬浮球相关，只保留核心
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
    // 合并逻辑，移除悬浮球的脏数据干扰
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

// 构建替换内容 (图片/文本)
const IMAGE_STYLE = 'height: 1.3em; width: auto; vertical-align: middle; position: relative; bottom: 0.15em; display: inline-block; margin: 0 2px; border-radius: 2px; cursor: help; object-fit: contain;';
function buildReplacement(rawValue) {
    const value = (rawValue ?? '').toString().trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) {
        return `<img src="${value}" title="$1" alt="icon" style="${IMAGE_STYLE}">`;
    }
    return value;
}

// 3. 核心应用逻辑 (去掉了悬浮球渲染调用)
function applyMask() {
    const settings = loadSettings();
    const context = getContext();
    
    // 如果总开关关闭，则视为不打码
    const masksActive = settings.masterEnabled;

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

        // 条件：总开关关了 OR 名字不存在 OR 单项开关关了 -> 移除脚本
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

// 4. 构建 UI (去繁就简版)
function buildUI() {
    const settings = loadSettings();

    const styleBlock = `
    <style>
        .tu-settings-wrapper { display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
        .tu-card {
            background: var(--smart-theme-bg-transfer, rgba(0, 0, 0, 0.15));
            border: 1px solid var(--smart-theme-border, rgba(255, 255, 255, 0.1));
            border-radius: 8px;
            padding: 12px;
            transition: all 0.2s ease;
        }
        .tu-card:hover { border-color: var(--smart-theme-accent, rgba(255, 255, 255, 0.3)); }
        
        /* 标题栏 */
        .tu-head-row {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 8px; padding-bottom: 8px;
            border-bottom: 1px dashed var(--smart-theme-border, rgba(255,255,255,0.1));
        }
        .tu-title { font-weight: 700; opacity: 0.9; }

        /* 输入框 */
        .tu-input-area {
            width: 100%; font-family: monospace; font-size: 1.1em;
            background: rgba(0, 0, 0, 0.2); border: 1px solid transparent; border-radius: 4px; padding: 8px; box-sizing: border-box;
        }
        .tu-input-area:focus { border-color: var(--smart-theme-accent, #aaa); outline: none; }

        /* 强调色总开关卡片 */
        .tu-master-card {
            border-left: 4px solid var(--smart-theme-accent, #4caf50);
        }
        .tu-master-card.disabled {
            border-left-color: #666;
            opacity: 0.8;
        }

        /* 保存按钮 */
        .tu-save-btn {
            background: var(--smart-theme-accent, #4caf50); 
            color: var(--smart-theme-accent-text, #fff);
            padding: 10px; border-radius: 6px; text-align: center;
            cursor: pointer; font-weight: 600; margin-top: 5px;
            transition: filter 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .tu-save-btn:hover { filter: brightness(1.15); }
        .tu-save-btn:active { transform: translateY(1px); }
        .tu-hint { font-size: 0.8em; opacity: 0.5; text-align: center; margin-top: 4px; display: block; }
    </style>
    `;

    // 辅助：生成输入卡片
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

    // 辅助：处理输入逻辑
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
                
                ${generateCard('user', '👤 {{user}} 替换设置', 'Emoji 或 图片链接')}
                ${generateCard('char', '🤖 {{char}} 替换设置', 'Emoji 或 图片链接')}

                <div class="tu-card tu-master-card ${settings.masterEnabled ? '' : 'disabled'}" id="tu-master-card-el">
                    <div class="tu-head-row" style="margin-bottom:0; padding-bottom:0; border:none;">
                        <div style="display:flex; flex-direction:column;">
                            <span class="tu-title" style="font-size:1.1em;">🛡️ 打码总开关</span>
                            <span style="font-size:0.85em; opacity:0.6; margin-top:2px;">一键启用或禁用所有替换</span>
                        </div>
                        <label class="switch_label" style="margin:0;">
                            <input type="checkbox" id="mask_master_cb" ${settings.masterEnabled ? "checked" : ""} />
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
                
                <div>
                    <div id="mask_save_btn" class="tu-save-btn">💾 保存并应用设置</div>
                    <small class="tu-hint">输入 http 链接会自动转为图片</small>
                </div>

            </div>
        </div>
    </div>
    `;

    $("#extensions_settings").append(html);

    // 交互逻辑：点击总开关时，稍微改变一下卡片样式增加反馈
    $("#mask_master_cb").on("change", function() {
        const isChecked = $(this).is(":checked");
        $("#tu-master-card-el").toggleClass("disabled", !isChecked);
    });

    // 保存逻辑
    $("#mask_save_btn").click(() => {
        const settings = loadSettings();
        
        // 保存 User/Char 设置
        $(".mask_enable_cb").each((_, el) => {
            const key = $(el).data("key");
            settings[key].enabled = $(el).is(":checked");
        });
        $(".mask_input").each((_, el) => {
            const key = $(el).data("key");
            settings[key].replacement = buildReplacementLocal($(el).val());
        });

        // 保存总开关
        settings.masterEnabled = $("#mask_master_cb").is(":checked");

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
    // 启动时清理一下旧的悬浮球元素（如果之前存在）
    $("#bubble_floating_toggle").remove();
});
