import React from "react";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  isDark: boolean;
}

const emojiCategories = [
  {
    title: "Smileys & People",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽", "👾", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🦷", "🦴", "👀", "👁️", "👅", "👄", "💋", "🩸"],
  },
  {
    title: "Animals & Nature",
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🦟", "🦗", "🕷️", "🕸️", "🦂", "🐢", "🐍", "🦎", "🐙", "🦑", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🐐", "🦌", "🐕", "🐩", "🐈", "🐓", "🦃", " peacock", " parrot", " swan", " flamingo", "🐇", "🦝", "🦡", "🦦", " sloth", " llama", " mammoth", " beaver", "🍁", "🍄", "🌾", "💐", "🌸", "🌹", "🌺", "🌻", "🌼", "🌿", "🌱", "🍀"],
  },
  {
    title: "Food & Drink",
    emojis: ["🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🌽", "🥕", " garlic", " onion", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🥞", "🧇", "🧀", "🍖", "🍗", "🥩", "🥓", "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🍳", "🥘", "🍲", "🥣", "🥗", "🍿", "🧈", "🧂", "🥫", "🍱", "🍘", "🍙", "🍚", "🍛", "🍜", "🍝", "🍠", "🍢", "🍣", "🍤", "🍥", "🥮", "🍡", "🥟", "🥠", "🥡", "🦀", "🦞", "🍤", "🍦", "🍧", "🍨", "🍩", "🍪", "🎂", "🍰", "🧁", "🥧", "🍫", "🍬", "🍭", "🍮", "🍯", "🍼", "🥛", "☕", "🍵", "🧉", "🥤", "🧃", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🍾", "🧊"],
  },
  {
    title: "Symbols & Flags",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "🕉️", "☮️", "✝️", "☪️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🈳", "🈹", "☣️", "☢️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "🉑", "💮", "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈲", "🇧🇩", "🇺🇸", "🇬🇧", "🇮🇳", "🇵🇰", "🇸🇦", "🇦🇪", "🇯🇵", "🇨🇳", "🇩🇪", "🇫🇷", "🇨🇦", "🇧🇷", "🇷🇺"],
  }
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose, isDark }) => {
  return (
    <div
      className={`absolute bottom-16 left-4 z-50 w-[320px] md:w-[360px] h-[340px] rounded-lg shadow-2xl border flex flex-col ${
        isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
      }`}
      style={{ animation: "slideUp 0.15s ease-out" }}
    >
      {/* Header */}
      <div className={`p-3 border-b flex justify-between items-center ${isDark ? "border-gray-700 bg-[#2a3942]" : "border-gray-100 bg-gray-50"}`}>
        <span className="font-semibold text-sm">Emojis</span>
        <button
          onClick={onClose}
          className="text-xs font-semibold text-[#00a884] hover:underline"
        >
          Close
        </button>
      </div>

      {/* Emoji list container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {emojiCategories.map((category, catIdx) => (
          <div key={catIdx} className="space-y-1.5">
            <h4 className="text-xs font-semibold opacity-60 sticky top-0 py-1 bg-inherit">
              {category.title}
            </h4>
            <div className="grid grid-cols-8 gap-1.5 justify-items-center">
              {category.emojis.map((emoji, emoIdx) => (
                <button
                  key={emoIdx}
                  onClick={() => onSelect(emoji)}
                  className="text-2xl hover:bg-black/5 dark:hover:bg-white/10 p-1 rounded-md transition-all active:scale-90"
                  title="Click to insert"
                  id={`emoji-${catIdx}-${emoIdx}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
