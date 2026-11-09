import * as React from 'react';

// Fix for React 18 vs React 19 monorepo types conflict on legacy class components
declare global {
  namespace React {
    interface Component<P = {}, S = {}, SS = any> {
      refs?: any;
    }
  }
}

declare module 'react' {
  interface Component<P = {}, S = {}, SS = any> {
    refs?: any;
  }
}

// Ensure @expo/vector-icons is always treated as a valid JSX ComponentType
declare module '@expo/vector-icons' {
  import { ComponentType } from 'react';
  import { TextProps, OpaqueColorValue, StyleProp, TextStyle } from 'react-native';

  export interface IconProps extends TextProps {
    name: string;
    size?: number;
    color?: string | OpaqueColorValue;
    style?: StyleProp<TextStyle>;
  }

  export const Ionicons: ComponentType<IconProps | any>;
  export const MaterialIcons: ComponentType<IconProps | any>;
  export const MaterialCommunityIcons: ComponentType<IconProps | any>;
  export const FontAwesome: ComponentType<IconProps | any>;
  export const FontAwesome5: ComponentType<IconProps | any>;
  export const FontAwesome6: ComponentType<IconProps | any>;
  export const Feather: ComponentType<IconProps | any>;
  export const AntDesign: ComponentType<IconProps | any>;
  export const Entypo: ComponentType<IconProps | any>;
  export const Octicons: ComponentType<IconProps | any>;
}
