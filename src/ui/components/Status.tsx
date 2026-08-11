import React from "react";
import type { LibraryConfig, StatusTone } from "../../core/library/config";
import { statusTone } from "../../core/library/config";
import { Icon } from "./shared";

/**
 * Statuses, wherever they appear.
 *
 * The label is the user's own word, so the meaning has to come from the tone
 * the config sorts it into. That tone picks both the colour and the glyph —
 * except for something you are part-way through, where the note already knows
 * how far and a ring says it better than an icon does.
 */

const TONE_ICONS: Record<StatusTone, string> = {
	planned: "clock",
	active: "play",
	done: "check",
	paused: "pause",
	dropped: "x",
};

export interface StatusBadgeProps {
	config: LibraryConfig;
	status: string;
	/** 0–1. Draws a ring instead of the glyph; omit when the note has no progress. */
	progress?: number;
	className?: string;
	size?: number;
}

/** The class that colours a status, for elements that draw their own markup. */
export function statusClass(
	config: LibraryConfig,
	status: string | undefined,
): string {
	const tone = statusTone(config, status);
	return tone ? ` scout-t-${tone}` : "";
}

/** The glyph for a status, for callers that draw their own icon — Obsidian's
 *  own menus take an icon name rather than an element. */
export function statusIconName(
	config: LibraryConfig,
	status: string | undefined,
): string {
	return TONE_ICONS[statusTone(config, status) ?? "planned"];
}

/** A ring, or the glyph for the tone. */
export function StatusIcon({
	config,
	status,
	progress,
	size = 12,
}: Omit<StatusBadgeProps, "className">): React.ReactElement {
	const tone = statusTone(config, status);
	if (tone === "active" && progress !== undefined) {
		return <ProgressRing value={progress} size={size} />;
	}
	return <Icon name={TONE_ICONS[tone ?? "planned"]} size={size} />;
}

export default function StatusBadge({
	config,
	status,
	progress,
	className = "",
	size = 12,
}: StatusBadgeProps): React.ReactElement {
	return (
		<span
			className={`scout-status-badge${statusClass(config, status)} ${className}`.trim()}
		>
			<StatusIcon
				config={config}
				status={status}
				progress={progress}
				size={size}
			/>
			<span className="scout-status-text">{status}</span>
		</span>
	);
}

/** How far through, at a glance. Stroke drawn from twelve o'clock. */
function ProgressRing({
	value,
	size,
}: {
	value: number;
	size: number;
}): React.ReactElement {
	const stroke = Math.max(1.5, size / 7);
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const filled = Math.min(Math.max(value, 0), 1) * circumference;
	const centre = size / 2;

	return (
		<svg
			className="scout-ring"
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			aria-hidden="true"
		>
			<circle
				className="scout-ring-track"
				cx={centre}
				cy={centre}
				r={radius}
				fill="none"
				strokeWidth={stroke}
			/>
			<circle
				className="scout-ring-fill"
				cx={centre}
				cy={centre}
				r={radius}
				fill="none"
				strokeWidth={stroke}
				strokeLinecap="round"
				strokeDasharray={`${filled} ${circumference}`}
				transform={`rotate(-90 ${centre} ${centre})`}
			/>
		</svg>
	);
}

/** The fraction to hand a badge, or undefined when the note records none. */
export function progressFraction(
	progress: number | undefined,
	total: number | undefined,
): number | undefined {
	if (progress === undefined || !total) return undefined;
	return Math.min(Math.max(progress / total, 0), 1);
}
