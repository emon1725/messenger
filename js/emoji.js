// ==========================================
// CHATSPHERE - EMOJI PANEL
// Depends on: js/supabase.js (el helper). Load before script.js.
// ==========================================


const EMOJI_CHOICES = [
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "😊",
    "😇", "🥰", "😍", "🤩", "😘", "😋", "😎", "🤔", "😐", "😴",
    "😮", "😢", "😭", "😡", "🤯", "🥳", "👍", "👎", "👏", "🙏",
    "💪", "🤝", "👋", "✌️", "❤️", "🧡", "💛", "💚", "💙", "💜",
    "🖤", "💔", "🔥", "✨", "⭐", "🎉", "🎂", "🌹", "☕", "🍕",
    "🚀", "✅", "❌", "💯", "📎", "📷", "🎵", "🌧️", "☀️", "🌙"
];

// Builds the grid of emoji buttons. onPick receives the chosen emoji as text.
function buildEmojiPanel(onPick) {

    const grid = el("div", "emoji-grid");

    EMOJI_CHOICES.forEach((emoji) => {

        const button = el("button", "emoji-btn", emoji);

        button.type = "button";
        button.title = "Insert emoji";

        button.addEventListener("click", () => onPick(emoji));

        grid.append(button);

    });

    return grid;

}

// Inserts text at the caret position of a text input.
function insertTextAtCaret(input, text) {

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;

    input.value = input.value.slice(0, start) + text + input.value.slice(end);

    const caret = start + text.length;

    input.setSelectionRange(caret, caret);
    input.focus();

}
