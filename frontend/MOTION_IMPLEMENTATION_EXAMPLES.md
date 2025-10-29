# Framer Motion Implementation Examples

This document provides practical examples for implementing motion animations in your pages and components.

## Quick Start Examples

### Example 1: Wrapping a Page with Smooth Transitions

```tsx
// app/feed/page.tsx
"use client";

import { MotionPageWrapper } from "@/components/motion-page-wrapper";
import { Card } from "@/components/ui/card";

export default function FeedPage() {
  return (
    <MotionPageWrapper>
      <div className="space-y-4">
        {/* Your existing content */}
      </div>
    </MotionPageWrapper>
  );
}
```

**Result:** Page content fades and slides up smoothly when navigating to it, and fades down when leaving.

---

### Example 2: Animated List with Stagger Effect

```tsx
// app/agents/page.tsx
"use client";

import { motion } from "framer-motion";
import { messageContainer, messageItem } from "@/lib/motion";

export default function AgentsPage({ agents }: { agents: Agent[] }) {
  return (
    <motion.div
      variants={messageContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      {agents.map((agent) => (
        <motion.div key={agent.id} variants={messageItem}>
          <AgentCard agent={agent} />
        </motion.div>
      ))}
    </motion.div>
  );
}
```

**Result:** Each agent card animates in sequence with a small delay, creating a cohesive wave effect.

---

### Example 3: Interactive Cards with Hover Lift

```tsx
// components/agent-card.tsx
"use client";

import { MotionCard, CardHeader, CardContent } from "@/components/ui/card";

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <MotionCard animated={true} className="cursor-pointer">
      <CardHeader>
        <h3>{agent.name}</h3>
      </CardHeader>
      <CardContent>
        <p>{agent.description}</p>
      </CardContent>
    </MotionCard>
  );
}
```

**Result:** Cards subtly lift and gain shadow on hover, providing visual feedback.

---

### Example 4: Dialog with Smooth Animation

The Dialog component is already configured with Framer Motion. Just use it normally:

```tsx
"use client";

import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function AgentDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Create Agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>
        {/* Your form content */}
      </DialogContent>
    </Dialog>
  );
}
```

**Result:** Dialog smoothly scales and fades in with a spring easing, feels premium.

---

### Example 5: Buttons with Tap Feedback

Buttons are already enhanced with Framer Motion:

```tsx
import { Button } from "@/components/ui/button";

<Button onClick={handleClick}>Click me</Button>
```

**Result:** On hover, button scales up slightly. On click, it compresses briefly (0.98x), providing tactile feedback.

---

### Example 6: Custom Animation for Important Actions

```tsx
"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

export function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [isConfirming, setIsConfirming] = React.useState(false);

  return (
    <motion.div
      layout
      className="flex gap-2"
    >
      {isConfirming ? (
        <motion.div
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          className="flex gap-2"
        >
          <Button variant="destructive" onClick={onConfirm}>
            Confirm Delete
          </Button>
          <Button variant="outline" onClick={() => setIsConfirming(false)}>
            Cancel
          </Button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
        >
          <Button variant="outline" onClick={() => setIsConfirming(true)}>
            Delete
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
```

**Result:** Confirmation buttons smoothly animate in/out with a layout shift.

---

### Example 7: Loading State Animation

```tsx
"use client";

import { motion } from "framer-motion";
import { pulseMotion } from "@/lib/motion";

export function LoadingMessage() {
  return (
    <motion.div
      variants={pulseMotion}
      initial="initial"
      animate="animate"
      className="text-muted-foreground"
    >
      Loading your data...
    </motion.div>
  );
}
```

**Result:** Text gently pulses for a softer loading indicator than typical CSS animations.

---

### Example 8: Image Grid with Hover Effects

Similar to ChatMessage but standalone:

```tsx
"use client";

import { motion } from "framer-motion";

export function ImageGrid({ images }: { images: string[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map((src, i) => (
        <motion.div
          key={i}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="cursor-pointer overflow-hidden rounded"
        >
          <img src={src} alt="" className="w-full h-32 object-cover" />
        </motion.div>
      ))}
    </div>
  );
}
```

**Result:** Images scale on hover and respond to touch/click with spring animation.

---

### Example 9: Sidebar Navigation Animation

```tsx
"use client";

import { motion } from "framer-motion";
import { sidebarMotion } from "@/lib/motion";

export function SidebarNav({ isOpen }: { isOpen: boolean }) {
  return (
    <motion.div
      variants={sidebarMotion}
      initial="hidden"
      animate={isOpen ? "visible" : "hidden"}
      className="w-64 bg-sidebar"
    >
      {/* Nav items */}
    </motion.div>
  );
}
```

**Result:** Sidebar smoothly slides in from the left with fade.

---

### Example 10: Notification with Entrance and Exit

```tsx
"use client";

import { motion } from "framer-motion";
import { slideInDown } from "@/lib/motion";

export function Notification({ message }: { message: string }) {
  return (
    <motion.div
      variants={slideInDown}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="bg-green-500 text-white p-4 rounded"
    >
      {message}
    </motion.div>
  );
}
```

**Result:** Notification slides down from top, then slides away when dismissed.

---

## Animation Checklists

### For Page Components

- [ ] Wrap page with `MotionPageWrapper` or `motion.div` with `pageMotion` variant
- [ ] Use `MotionStaggerContainer` for lists/grids
- [ ] Set `"use client"` directive
- [ ] Ensure `AnimatePresence` is active in Providers

### For Card/List Items

- [ ] Use `messageItem` variant in container's variants
- [ ] Wrap in `messageContainer` for staggering
- [ ] Add hover effects with `MotionCard` or custom `whileHover`
- [ ] Use spring transitions for natural feel

### For Modals/Dialogs

- [ ] Use updated `Dialog` component (already has animations)
- [ ] Ensure `AnimatePresence` is wrapping the dialog
- [ ] Test exit animation (should fade out)

### For Forms

- [ ] Animate field errors with `slideInDown`
- [ ] Use `motion.button` or enhanced Button component
- [ ] Animate submit feedback with `pulseMotion` or scale

---

## Common Patterns

### Conditional Content Animation

```tsx
{showContent && (
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    transition={{ duration: 0.3 }}
  >
    Content appears here
  </motion.div>
)}
```

### Toggle Animation

```tsx
<motion.div layout>
  {isExpanded && (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    >
      Expandable content
    </motion.div>
  )}
</motion.div>
```

### Sequential Button Actions

```tsx
<motion.div className="flex gap-2">
  {[1, 2, 3].map((i) => (
    <motion.div
      key={i}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.1 }}
    >
      <Button>Action {i}</Button>
    </motion.div>
  ))}
</motion.div>
```

---

## Testing Motion

### Manual Testing Checklist

1. **Page Transitions**: Navigate between pages, observe smooth fade/slide
2. **List Items**: Scroll through lists, verify stagger animation
3. **Hover Effects**: Hover over cards and buttons, observe lifts/scales
4. **Dialogs**: Open/close dialogs multiple times, ensure smooth animation
5. **Mobile**: Test on mobile device, animations should feel responsive
6. **Accessibility**: Open DevTools → Accessibility → check for motion
7. **Performance**: Use DevTools Performance tab to check for jank

### Reduced Motion Testing

```bash
# On macOS:
# System Preferences → Accessibility → Display → Reduce Motion

# Then open app and verify:
# - Animations still occur (not completely disabled)
# - Much shorter/subtle durations
# - No jarring transitions
```

---

## Performance Tips

1. **Measure Before Optimizing**
   ```tsx
   // Use React DevTools Profiler to identify slow renders
   ```

2. **Avoid Animating Layout Changes**
   - Use `layout` prop sparingly (can cause jank)
   - Prefer `transform` and `opacity`

3. **Use `AnimatePresence` Correctly**
   - Always wrap animated exits with `AnimatePresence`
   - Set appropriate `mode` (usually `"wait"`)

4. **Lazy Load Heavy Animations**
   ```tsx
   const AnimatedComponent = lazy(() => import('./animated'));
   ```

5. **Disable on Low-End Devices**
   ```tsx
   const prefersReduced = window.matchMedia('(prefers-reduced-motion)').matches;
   const animate = !prefersReduced;
   ```

---

## Next Steps

1. Gradually add `MotionPageWrapper` to key pages
2. Wrap list sections with `MotionStaggerContainer`
3. Replace manual loaders with `pulseMotion`
4. Test on real devices, especially mobile
5. Gather user feedback on animation feel
6. Iterate on spring constants and durations

