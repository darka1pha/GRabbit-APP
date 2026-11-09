import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const StackNavigator = Stack as any;

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <StackNavigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#ffffff',
          contentStyle: { backgroundColor: '#020617' },
        }}
      >
        <StackNavigator.Screen name="index" options={{ title: 'gRabbit' }} />
      </StackNavigator>
    </>
  );
}
