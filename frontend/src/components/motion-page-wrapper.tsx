'use client';

import React from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { pageMotion } from '@/lib/motion';

interface MotionPageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A wrapper component that provides smooth page transitions using Framer Motion.
 * Wrap your page content with this component for consistent entrance/exit animations.
 */
export function MotionPageWrapper({ children, className }: MotionPageWrapperProps) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        variants={pageMotion}
        initial="initial"
        animate="animate"
        exit="exit"
        className={className}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

/**
 * A container for animating child elements with stagger effects.
 * Useful for lists, grids, or any sequential animations.
 */
export function MotionStaggerContainer({
  children,
  className,
  delay = 0.1,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: delay,
            delayChildren: 0.05,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Individual item for use within MotionStaggerContainer.
 */
export function MotionStaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
      }}
    >
      {children}
    </motion.div>
  );
}

