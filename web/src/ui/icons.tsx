import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

// Orbyn design glyphs, version e0369c1. Shared Planner family: 24px grid / 1.6px stroke.
// Use one renderer so Settings, navigation and editor actions keep the same line weight.
function icon(name: string, shapes: ReactNode) {
  return function OrbynIcon({ size = 15, ...props }: IconProps) {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        {...props}
        data-icon={name}
        style={{ flexShrink: 0, ...props.style }}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shapes}
      </svg>
    );
  };
}

export const Settings = icon(
  "gear",
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>,
);
export const Type = icon(
  "text",
  <>
    <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />
  </>,
);
export const BookOpen = icon(
  "book",
  <>
    <path d="M4.5 5.5A2 2 0 0 1 6.5 3.5h12v15h-12a2 2 0 0 0-2 2z" />
    <path d="M4.5 20.5v-15M8.5 7.5h6" />
  </>,
);
export const CheckSquare = icon(
  "check",
  <>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </>,
);
export const Globe = icon(
  "globe",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" />
  </>,
);
export const Hash = icon(
  "hash",
  <>
    <path d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15M4 15h15" />
  </>,
);
export const Users = icon(
  "users",
  <>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.5.6 2.6 2 3 4.2" />
  </>,
);
export const PanelLeft = icon(
  "sidebar",
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </>,
);
export const Copy = icon(
  "copy",
  <>
    <rect x="8" y="8" width="11.5" height="11.5" rx="2" />
    <path d="M5 15.5V6a1.5 1.5 0 0 1 1.5-1.5H16" />
  </>,
);
export const X = icon(
  "x",
  <>
    <path d="M7 7l10 10M17 7L7 17" />
  </>,
);
export const ChevronLeft = icon(
  "left",
  <>
    <path d="M14.5 6l-6 6 6 6" />
  </>,
);
export const ChevronRight = icon(
  "right",
  <>
    <path d="M9.5 6l6 6-6 6" />
  </>,
);
export const ChevronDown = icon(
  "down",
  <>
    <path d="M7 10l5 5 5-5" />
  </>,
);
export const Pin = icon(
  "pin",
  <>
    <path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8" />
  </>,
);
export const Paperclip = icon(
  "clip",
  <>
    <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7.2" />
  </>,
);
export const Search = icon(
  "search",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>,
);
export const Link2 = icon(
  "link",
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>,
);
export const Download = icon(
  "download",
  <>
    <path d="M12 4.5v11M7 11l5 5 5-5M5 19.5h14" />
  </>,
);
export const RefreshCw = icon(
  "refresh",
  <>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
  </>,
);
export const Plug = icon(
  "plug",
  <>
    <path d="M9 3.5v5M15 3.5v5M6.5 8.5h11V12a5.5 5.5 0 0 1-11 0zM12 17.5v3" />
  </>,
);
export const FileText = icon(
  "doc",
  <>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
    <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
  </>,
);
export const Plus = icon(
  "plus",
  <>
    <path d="M12 5v14M5 12h14" />
  </>,
);
export const Pencil = icon(
  "edit",
  <>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </>,
);
export const Layers = icon(
  "layers",
  <>
    <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
    <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
  </>,
);
export const Sun = icon(
  "sun",
  <>
    <circle cx="12" cy="12" r="3.8" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </>,
);
export const Trash2 = icon(
  "trash",
  <>
    <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5" />
  </>,
);
export const Check = icon(
  "check2",
  <>
    <path d="M5.5 12.5l4 4 9-9" />
  </>,
);
export const Cards = icon(
  "cards",
  <>
    <rect x="6.5" y="3.5" width="12" height="15" rx="2" />
    <path d="M4 7v12a2 2 0 0 0 2 2h9" />
  </>,
);
export const ArrowLeft = ChevronLeft;
export const CalendarDays = icon(
  "cal",
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>,
);
export const Menu = icon(
  "sidebar",
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </>,
);
export const Note = icon(
  "note",
  <>
    <path d="M6 4h9l3 3v13H6z" />
    <path d="M9 11h6M9 14.5h4" />
  </>,
);
// Existing Windows caption, tag and sign-out outlines; Lucide 1.70.0, ISC. See third-party-notices.txt.
export const LogOut = icon(
  "log-out",
  <>
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
  </>,
);
export const Minus = icon("minus", <path d="M5 12h14" />);
export const Square = icon(
  "square",
  <rect x="3" y="3" width="18" height="18" rx="2" />,
);
export const RestoreWindow = icon(
  "restore-window",
  <>
    <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>,
);
export const Tags = icon(
  "tags",
  <>
    <path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z" />
    <path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193" />
    <circle cx="10.5" cy="6.5" r=".5" fill="currentColor" />
  </>,
);

// Editor controls share the Orbyn renderer. Existing Lucide 1.70.0 ISC glyph
// extensions retain their notice in public/third-party-notices.txt.
export const Bold = icon(
  "bold",
  <>
    <path d="M6 12h9a4 4 0 010 8H7a1 1 0 01-1-1V5a1 1 0 011-1h7a4 4 0 010 8" />
  </>,
);
export const Italic = icon(
  "italic",
  <>
    <line x1="19" x2="10" y1="4" y2="4" />
    <line x1="14" x2="5" y1="20" y2="20" />
    <line x1="15" x2="9" y1="4" y2="20" />
  </>,
);
export const Strikethrough = icon(
  "strikethrough",
  <>
    <path d="M16 4H9a3 3 0 0 0-2.83 4" />
    <path d="M14 12a4 4 0 0 1 0 8H6" />
    <line x1="4" x2="20" y1="12" y2="12" />
  </>,
);
export const Code = icon(
  "code",
  <>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </>,
);
export const List = icon(
  "list",
  <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
);
export const ListOrdered = icon(
  "list-ordered",
  <>
    <path d="M11 5h10" />
    <path d="M11 12h10" />
    <path d="M11 19h10" />
    <path d="M4 4h1v5" />
    <path d="M4 9h2" />
    <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />
  </>,
);
export const ListTodo = icon(
  "list-todo",
  <>
    <path d="M13 5h8" />
    <path d="M13 12h8" />
    <path d="M13 19h8" />
    <path d="m3 17 2 2 4-4" />
    <rect x="3" y="4" width="6" height="6" rx="1" />
  </>,
);
export const Quote = icon(
  "quote",
  <>
    <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
    <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
  </>,
);
export const Link = Link2;
export const Undo2 = icon(
  "undo2",
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
  </>,
);
export const Redo2 = icon(
  "redo2",
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
  </>,
);
export const MoreHorizontal = icon(
  "more-horizontal",
  <path d="M6 12h.01M12 12h.01M18 12h.01" />,
);
export const Eye = icon(
  "eye",
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>,
);
export const FileCode = icon(
  "file-code",
  <>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M10 12.5 8 15l2 2.5" />
    <path d="m14 12.5 2 2.5-2 2.5" />
  </>,
);
