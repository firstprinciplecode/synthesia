# Framer Motion Integration Guide

This document describes the Framer Motion animation library integration for a smooth, modern interface experience.

## Installation

Framer Motion is already installed. Check `frontend/package.json` for the latest version.

```bash
npm install framer-motion
```

## Core Files

### 1. Motion Variants Library (`src/lib/motion.ts`)

Centralized collection of reusable animation variants and transition configs:

- **Fade animations**: `fadeIn`
- **Slide animations**: `slideInUp`, `slideInDown`, `slideInLeft`, `slideInRight`
- **Scale animations**: `scaleIn`, `scaleUp`
- **Dialog/Modal**: `dialogMotion` (spring-based with cubic-bezier easing)
- **Message list**: `messageContainer`, `messageItem` (with stagger effect)
- **Hover effects**: `hoverScale`, `hoverLift`
- **Rotation**: `rotateIn`
- **Pulse animations**: `pulseMotion` (for loading states)
- **Spring transition**: `springTransition` (snappy feedback)
- **Page transitions**: `pageMotion` (smooth page exits/entries)
- **Sidebar/Panels**: `sidebarMotion`, `sheetMotion`

## Updated Components

### 2. Dialog Component (`src/components/ui/dialog.tsx`)

**Changes:**
- Overlay fades in smoothly with `motion.div`
- Content uses `dialogMotion` variant with spring easing for polished entry
- Exit animations for clean dismissals

**Usage:**
```tsx
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

<Dialog>
  <DialogTrigger>Open</DialogTrigger>
  <DialogContent>Your content</DialogContent>
</Dialog>
```

### 3. Button Component (`src/components/ui/button.tsx`)

**Changes:**
- Uses `motion.button` for all button variants
- Hover: subtle scale-up (1.02x)
- Tap: immediate feedback with scale-down (0.98x)
- Spring transition for snappy, natural feel

**Usage:**
```tsx
import { Button } from '@/components/ui/button';

<Button>Click me</Button>
```

### 4. Chat Message Component (`src/components/chat/ChatMessage.tsx`)

**Changes:**
- Messages now use `messageItem` variant for staggered entrance
- Avatar fades and scales in on appearance
- Image grid items have hover lift with shadow effect
- Lightbox modal uses smooth scale/fade animations
- Maintains existing content rendering logic

**Usage:**
```tsx
import { ChatMessage } from '@/components/chat/ChatMessage';

<ChatMessage message={msg} isStreaming={isStreaming} />
```

### 5. Card Component (`src/components/ui/card.tsx`)

**Changes:**
- Basic `Card` component (unchanged, non-animated)
- New `MotionCard` export for animated versions
- Hover animation: lifts card with shadow depth
- Spring transition for natural motion

**Usage:**
```tsx
import { Card, MotionCard, CardHeader, CardContent } from '@/components/ui/card';

// Non-animated
<Card>...</Card>

// Animated
<MotionCard animated={true}>
  <CardHeader>...</CardHeader>
  <CardContent>...</CardContent>
</MotionCard>
```

### 6. Providers (`src/components/Providers.tsx`)

**Changes:**
- Added `AnimatePresence` wrapper with `mode="wait"`
- Enables smooth exit animations for pages and modal components
- Respects user's `prefers-reduced-motion` setting

## New Components

### 7. Motion Page Wrapper (`src/components/motion-page-wrapper.tsx`)

Three utility components for consistent animations:

#### `MotionPageWrapper`

Wrap your entire page for smooth transitions:

```tsx
'use client';

import { MotionPageWrapper } from '@/components/motion-page-wrapper';

export default function Page() {
  return (
    <MotionPageWrapper>
      {/* Your page content */}
    </MotionPageWrapper>
  );
}
```

#### `MotionStaggerContainer` + `MotionStaggerItem`

For animating lists, grids, or sequential content:

```tsx
import { MotionStaggerContainer, MotionStaggerItem } from '@/components/motion-page-wrapper';

<MotionStaggerContainer delay={0.1}>
  {items.map(item => (
    <MotionStaggerItem key={item.id}>
      {/* Item content */}
    </MotionStaggerItem>
  ))}
</MotionStaggerContainer>
```

## Usage Patterns

### Pattern 1: Simple Component Animation

```tsx
import { motion } from 'framer-motion';
import { slideInUp } from '@/lib/motion';

<motion.div variants={slideInUp} initial="hidden" animate="visible">
  Content here
</motion.div>
```

### Pattern 2: Hover Effects

```tsx
import { motion } from 'framer-motion';

<motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.98 }}>
  Interactive content
</motion.div>
```

### Pattern 3: Staggered List

```tsx
import { messageContainer, messageItem } from '@/lib/motion';

<motion.div variants={messageContainer} initial="hidden" animate="visible">
  {messages.map(msg => (
    <motion.div key={msg.id} variants={messageItem}>
      {msg.content}
    </motion.div>
  ))}
</motion.div>
```

### Pattern 4: Modal/Dialog

```tsx
import { dialogMotion } from '@/lib/motion';

<motion.div variants={dialogMotion} initial="hidden" animate="visible" exit="exit">
  Modal content
</motion.div>
```

## Best Practices

1. **Use Centralized Variants**: Import animations from `@/lib/motion.ts` for consistency.

2. **Respect Reduced Motion**: Framer Motion's `MotionConfig` with `reducedMotion="user"` automatically respects system preferences.

3. **Duration Guidelines**:
   - Quick feedback (buttons): 0.2-0.3s
   - Normal animations (entrances): 0.3-0.4s
   - Slower animations (full page): 0.4-0.5s

4. **Easing**:
   - `easeOut` for entrances (snappier feel)
   - `easeInOut` for symmetrical animations
   - `spring` for bouncy, interactive feedback

5. **Avoid Over-Animation**: Not every element needs motion. Focus on:
   - User interactions (hover, click)
   - Page/modal transitions
   - List/grid items
   - Important status changes

6. **Mobile Considerations**: Spring animations perform well on mobile. Keep durations reasonable (< 0.5s).

## Performance Notes

- Framer Motion uses `transform` and `opacity` for GPU-accelerated animations
- Avoid animating heavy properties like `width`, `height`, or `box-shadow` simultaneously
- Use `layout` prop carefully—it triggers layout recalculation
- For very long lists, consider lazy animation trigger using `Intersection Observer`

## Accessibility

- `AnimatePresence mode="wait"` prevents overlapping animations that might confuse screen readers
- `MotionConfig reducedMotion="user"` respects `prefers-reduced-motion`
- All animations are supplementary; ensure functionality works without motion

## Future Enhancements

1. **Page Transitions**: Wrap individual page components with `MotionPageWrapper`
2. **Scroll Animations**: Use Framer Motion's scroll-triggered animations for hero sections
3. **Gesture Animations**: Add drag, swipe, and pan animations for mobile
4. **Custom Variants**: Create domain-specific animation variants (e.g., `notificationSlide`, `cardFlip`)
5. **Transition Settings**: Create a centralized config file for global transition defaults

## Troubleshooting

### Animations Not Triggering

- Ensure component has `use client` directive
- Check `initial`, `animate`, and `exit` props are set
- Verify `AnimatePresence` wraps the component in Providers

### Animation Jank

- Profile with Chrome DevTools Performance tab
- Check if animating expensive properties (width, height, top, left)
- Use `transform` and `opacity` instead
- Consider `willChange` CSS property

### Conflicting CSS Animations

- Framer Motion animations override Tailwind's `@apply` animations
- Remove conflicting `animate-*` Tailwind classes when using motion variants
- Use `transition={{ duration: 0 }}` if you need to disable motion temporarily

## Resources

- [Framer Motion Docs](https://www.framer.com/motion/)
- [Animation Best Practices](https://www.framer.com/motion/introduction/#best-practices)
- [Spring Animations Guide](https://www.framer.com/motion/animation/#spring)

