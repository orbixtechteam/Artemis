// A full page or sheet: round close / back button on the left, the title in the middle, an optional button on the right.
import React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { RoundButton } from './ui';

export function PageHeader({ title, icon = 'x', right, sheet, onBack }) {
  const { c } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: (sheet ? 16 : insets.top + 6), paddingBottom: 12 }}>
      <RoundButton icon={icon} label="Close" onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))} c={c} size={52} />
      <Text style={{ flex: 1, textAlign: 'center', color: c.text, fontSize: 20, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
      <View style={{ width: 52, alignItems: 'flex-end' }}>{right || null}</View>
    </View>
  );
}
