'use client';

import React from 'react';

interface TypingDotsProps {
	width?: number;
	height?: number;
	color?: string;
}

export function TypingDots({ width = 36, height = 12, color = 'currentColor' }: TypingDotsProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 48 12"
			fill="none"
			aria-hidden="true"
			focusable="false"
			className="inline-block align-middle"
		>
			<circle cx="8" cy="6" r="3" fill={color}>
				<animate attributeName="cy" values="6;3;6;9;6" dur="1.2s" begin="0s" repeatCount="indefinite" />
			</circle>
			<circle cx="24" cy="6" r="3" fill={color}>
				<animate attributeName="cy" values="6;3;6;9;6" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
			</circle>
			<circle cx="40" cy="6" r="3" fill={color}>
				<animate attributeName="cy" values="6;3;6;9;6" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
			</circle>
		</svg>
	);
}


