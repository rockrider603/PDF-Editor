export const THEMES = [
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
];

export const PDF_UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  ACCEPTED_FORMATS: ["application/pdf"],
  MAX_UPLOADS_PER_SESSION: 5,
};

export const EDITING_TOOLS = [
  { id: "highlight", label: "Highlight", icon: "🎨" },
  { id: "strikethrough", label: "Strikethrough", icon: "📝" },
  { id: "underline", label: "Underline", icon: "✏️" },
  { id: "notes", label: "Add Notes", icon: "📌" },
  { id: "crop", label: "Crop", icon: "✂️" },
];

export const NOTIFICATION_MESSAGES = {
  UPLOAD_SUCCESS: "PDF uploaded successfully!",
  UPLOAD_ERROR: "Failed to upload PDF. Please try again.",
  FILE_TOO_LARGE: "File size exceeds 50MB limit",
  INVALID_FORMAT: "Please upload a valid PDF file",
  PROCESSING: "Processing your PDF...",
};