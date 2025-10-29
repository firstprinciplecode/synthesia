# Framer Motion - Quick Reference Card

## Import Statements

```tsx
// Main library
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';

// From motion library
import { 
  fadeIn, 
  slideInUp, 
  slideInDown,
  slideInLeft,
  slideInRight,
  scaleIn,
  scaleUp,
  dialogMotion,
  messageContainer,
  messageItem,
  pageMotion,
  sidebarMotion,
  hoverScale,
  hoverLift,
  pulseMotion,
  springTransition
} from '@/lib/motion';

// Components
import { MotionPageWrapper, MotionStaggerContainer, MotionStaggerItem } from '@/components/motion-page-wrapper';
import { MotionCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button'; // Already has motion!
import { Dialog, DialogContent } from '@/components/ui/dialog'; // Already has motion!
```

## Component Motion Cheat Sheet

| Component | Motion Type | How to Use | Result |
|-----------|------------|-----------|--------|
| `Button` | Built-in | Just use it! | Hover scale 1.02x, tap 0.98x |
| `Dialog` | Built-in | Just use it! | Spring scale entrance, fade overlay |
| `MotionCard` | Animated | `<MotionCard animated={true}>` | Hover lift with shadow |
| `MotionPageWrapper` | Page transition | Wrap page content | Fade + slide entrance/exit |

## Common Animation Patterns

### 1. Fade In
```tsx
<motion.div variants={fadeIn} initial="hidden" animate="visible">
  Content
</motion.div>
```

### 2. Slide Up (Message style)
```tsx
<motion.div variants={slideInUp} initial="hidden" animate="visible">
  Content
</motion.div>
```

### 3. Scale In (Dialog style)
```tsx
<motion.div variants={scaleIn} initial="hidden" animate="visible">
  Content
</motion.div>
```

### 4. Page Transition
```tsx
<motion.div variants={pageMotion} initial="initial" animate="animate" exit="exit">
  {children}
</motion.div>
```

### 5. Staggered List
```tsx
<motion.div variants={messageContainer} initial="hidden" animate="visible">
  {items.map(item => (
    <motion.div key={item.id} variants={messageItem}>
      {item.content}
    </motion.div>
  ))}
</motion.div>
```

### 6. Hover Effect
```tsx
<motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.98 }}>
  Content
</motion.div>
```

### 7. Custom Animation
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -20 }}
  transition={{ duration: 0.3 }}
>
  Content
</motion.div>
```

### 8. Pulse/Loading
```tsx
<motion.div variants={pulseMotion} initial="initial" animate="animate">
  Loading...
</motion.div>
```

### 9. Conditional Animation
```tsx
{showContent && (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
  >
    Content
  </motion.div>
)}
```

### 10. Spring Animation
```tsx
<motion.div
  initial={{ scale: 0 }}
  animate={{ scale: 1 }}
  transition={springTransition}
>
  Content
</motion.div>
```

## Animation Values Quick Guide

| Effect | Duration | Easing | Use Case |
|--------|----------|--------|----------|
| Hover | 0.2-0.3s | spring | Button hover, link hover |
| Entrance | 0.3-0.4s | easeOut | Page load, dialog open |
| Exit | 0.2s | easeOut | Page leave, close dialog |
| Stagger delay | 0.05-0.1s | - | List items |
| Loading | 2s (loop) | easeInOut | Pulse animations |

## Transition Presets

```tsx
// Spring (snappy, natural)
transition={{ type: "spring", stiffness: 300, damping: 17 }}

// Timed (smooth)
transition={{ duration: 0.3, ease: "easeOut" }}

// Quick
transition={{ duration: 0.2 }}

// Slow
transition={{ duration: 0.5 }}
```

## State Animation Keywords

```tsx
// Common motion attribute states
initial       // Starting state
animate       // Target state
exit          // When unmounting (requires AnimatePresence)
whileHover    // While mouse over
whileTap      // While clicked
whileFocus    // While focused
whileDrag     // While dragging
```

## Positioning Animation

```tsx
// Move animations use x (horizontal) and y (vertical)
<motion.div initial={{ y: 20 }} animate={{ y: 0 }}>
  Slide up from bottom
</motion.div>

<motion.div initial={{ x: -20 }} animate={{ x: 0 }}>
  Slide in from left
</motion.div>
```

## Scale & Rotate

```tsx
// Scale (zoom)
initial={{ scale: 0.9 }}
animate={{ scale: 1 }}

// Rotate (degrees)
initial={{ rotate: -10 }}
animate={{ rotate: 0 }}

// Combined
initial={{ scale: 0.9, rotate: -10, opacity: 0 }}
animate={{ scale: 1, rotate: 0, opacity: 1 }}
```

## Multiple Items Animation

```tsx
// Option 1: Stagger with variants (recommended)
<motion.div variants={messageContainer} initial="hidden" animate="visible">
  {items.map(item => (
    <motion.div key={item.id} variants={messageItem}>{item}</motion.div>
  ))}
</motion.div>

// Option 2: Manual stagger with delay
{items.map((item, i) => (
  <motion.div
    key={item.id}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay: i * 0.1 }}
  >
    {item}
  </motion.div>
))}
```

## Conditional Animation Wrapper

```tsx
// Wrap AnimatePresence around conditional elements
<AnimatePresence>
  {isVisible && (
    <motion.div exit={{ opacity: 0 }}>
      Content that animates out on unmount
    </motion.div>
  )}
</AnimatePresence>
```

## Layout Animation

```tsx
// Animate when layout changes (use sparingly!)
<motion.div layout>
  {isExpanded && <ExpandedContent />}
</motion.div>
```

## Performance Tips (TL;DR)

✅ **DO animate**
- `opacity`
- `transform` (scale, rotate, x, y)

❌ **AVOID animating**
- `width`, `height`
- `top`, `left`, `right`, `bottom`
- `box-shadow`

## Debug Checklist

- [ ] Component has `use client`
- [ ] `initial`, `animate`, `exit` all set
- [ ] `AnimatePresence` wraps element (if using `exit`)
- [ ] `motion.div` not `<div>`
- [ ] No conflicting Tailwind `animate-*` classes
- [ ] No console errors
- [ ] DevTools: Check Performance tab (60fps?)

## Common Problems

| Issue | Solution |
|-------|----------|
| Animation not triggering | Add `use client` directive |
| Exit animation not working | Wrap with `<AnimatePresence>` |
| Jank/stutter | Avoid width/height/top/left animations |
| Tailwind animation conflicts | Remove `animate-*` Tailwind classes |
| Too fast/slow | Adjust `duration` in transition |
| Movement feels robotic | Use `spring` transition instead of timed |

## Resources

- 📚 [Framer Motion Docs](https://www.framer.com/motion)
- 🎨 [Animation Principles](https://www.framer.com/motion/introduction/#best-practices)
- ⚡ [Performance Guide](https://www.framer.com/motion/performance)
- ♿ [Accessibility](https://www.framer.com/motion/accessibility)

---

**Tip:** Start with the `variant`-based approach—it's the cleanest and most reusable!

