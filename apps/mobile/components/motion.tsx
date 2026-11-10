import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

export interface MotionTransformState {
  opacity?: number;
  translateY?: number;
  translateX?: number;
  scale?: number;
}

export interface MotionTransition {
  type?: 'spring' | 'timing';
  duration?: number;
  delay?: number;
  damping?: number;
  stiffness?: number;
}

export interface MotionViewProps {
  initial?: MotionTransformState;
  animate?: MotionTransformState;
  transition?: MotionTransition;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Declarative hardware-accelerated Motion container for React Native.
 * Supports spring & timing transitions for opacity, translateY, translateX, and scale.
 */
export function MotionView({
  initial = { opacity: 0, translateY: 10, scale: 1 },
  animate = { opacity: 1, translateY: 0, translateX: 0, scale: 1 },
  transition = { type: 'spring', damping: 18, stiffness: 180, delay: 0 },
  style,
  children,
}: MotionViewProps) {
  const opacity = useRef(new Animated.Value(initial.opacity ?? 1)).current;
  const translateY = useRef(new Animated.Value(initial.translateY ?? 0)).current;
  const translateX = useRef(new Animated.Value(initial.translateX ?? 0)).current;
  const scale = useRef(new Animated.Value(initial.scale ?? 1)).current;

  useEffect(() => {
    const targetOpacity = animate.opacity ?? 1;
    const targetY = animate.translateY ?? 0;
    const targetX = animate.translateX ?? 0;
    const targetScale = animate.scale ?? 1;
    const delay = transition.delay ?? 0;
    const isSpring = transition.type !== 'timing';

    const makeAnim = (val: Animated.Value, toValue: number) =>
      isSpring
        ? Animated.spring(val, {
            toValue,
            damping: transition.damping ?? 18,
            stiffness: transition.stiffness ?? 180,
            mass: 0.8,
            delay,
            useNativeDriver: true,
          })
        : Animated.timing(val, {
            toValue,
            duration: transition.duration ?? 220,
            delay,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          });

    const composite = Animated.parallel([
      Animated.timing(opacity, {
        toValue: targetOpacity,
        duration: transition.duration ?? 220,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      makeAnim(translateY, targetY),
      makeAnim(translateX, targetX),
      makeAnim(scale, targetScale),
    ]);

    composite.start();
    return () => composite.stop();
  }, [
    animate.opacity,
    animate.translateY,
    animate.translateX,
    animate.scale,
    transition.delay,
    transition.duration,
    transition.type,
    transition.damping,
    transition.stiffness,
    opacity,
    translateY,
    translateX,
    scale,
  ]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateY }, { translateX }, { scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export interface MotionPressableProps extends Omit<PressableProps, 'style'> {
  scaleOnPress?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Interactive tactile button wrapper with spring scale-down on press (`whileTap={{ scale }}`).
 */
export function MotionPressable({
  scaleOnPress = 0.96,
  style,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: MotionPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn: PressableProps['onPressIn'] = (e) => {
    if (!disabled) {
      Animated.spring(scale, {
        toValue: scaleOnPress,
        damping: 15,
        stiffness: 300,
        mass: 0.6,
        useNativeDriver: true,
      }).start();
    }
    onPressIn?.(e);
  };

  const handlePressOut: PressableProps['onPressOut'] = (e) => {
    Animated.spring(scale, {
      toValue: 1,
      damping: 14,
      stiffness: 260,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Pressable
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Continuous breathing / pulse animation wrapper (ideal for active audio recognition or active badges).
 */
export function PulseMotion({
  active = true,
  style,
  children,
}: {
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.07,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  return (
    <Animated.View style={[style, { transform: [{ scale: pulse }] }]}>
      {children}
    </Animated.View>
  );
}

