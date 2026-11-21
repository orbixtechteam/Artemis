import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../src/lib/session';

function Shell() {
  const { c, scheme } = useSession();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="connect" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="projects" />
        <Stack.Screen name="memory" />
        <Stack.Screen name="settings" options={{ presentation: 'modal', contentStyle: { backgroundColor: c.side } }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
