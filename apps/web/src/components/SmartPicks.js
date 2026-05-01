import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Play, ChevronRight } from "lucide-react";
export default function SmartPicks({ picks, fallbackArt, onPick, onViewAll }) {
    return (_jsxs("section", { className: "content-section", children: [_jsxs("div", { className: "section-header", children: [_jsx("h2", { children: "Smart picks for you" }), _jsxs("button", { className: "section-link", onClick: onViewAll, children: ["View all", _jsx(ChevronRight, { size: 16 })] })] }), _jsx("div", { className: "smart-picks", children: picks.map((pick) => (_jsxs("button", { className: "smart-pick", onClick: () => onPick(pick.song), children: [_jsx("img", { src: pick.song.artworkUrl || fallbackArt, alt: pick.title }), _jsxs("div", { className: "smart-pick__copy", children: [_jsx("strong", { children: pick.title }), _jsx("span", { children: pick.subtitle })] }), _jsx("span", { className: "smart-pick__play", children: _jsx(Play, { size: 14 }) })] }, pick.id))) })] }));
}
