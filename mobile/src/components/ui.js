// Building blocks in the Artemis look: round icon buttons, the bow-and-arrow mark, grouped cards with icon rows,
// pill buttons and fields.
import React from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Polyline, Line, Polygon } from 'react-native-svg';

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'ui-serif, "New York", Georgia, serif' });

/** The Artemis mark (a drawn bow with its arrow), in the accent colour. */
export function Logo({ size = 44, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M20 6 A27 27 0 0 1 20 58 A33 33 0 0 0 20 6 Z" fill={color} />
      <Polyline points="20,6 9,32 20,58" fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Line x1="9" y1="32" x2="50" y2="32" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
      <Polygon points="60,32 48,25 48,39" fill={color} />
    </Svg>
  );
}

export function Icon({ name, size = 22, color }) { return <Feather name={name} size={size} color={color} />; }

/** A round button with an icon (the header buttons). */
export function RoundButton({ icon, onPress, c, label, size = 46, children, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: c.round, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.7 : 1, borderWidth: 1, borderColor: c.line })}>
      {children || <Icon name={icon} size={size * 0.46} color={c.text} />}
    </Pressable>
  );
}

/** Rounded pill: "New chat", "Connect". */
export function Pill({ title, icon, onPress, c, disabled, tone = 'pill' }) {
  const bg = tone === 'accent' ? c.accent : tone === 'quiet' ? c.round : c.pill;
  const fg = tone === 'accent' ? c.accentText : tone === 'quiet' ? c.text : c.pillText;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: bg, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 22, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}>
      {icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 17, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

/** Kept for older screens: a plain button. */
export function Button({ title, onPress, disabled, primary, danger, small, c }) {
  const bg = primary ? c.accent : 'transparent';
  const fg = primary ? c.accentText : danger ? c.danger : c.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => ({ backgroundColor: bg, borderWidth: primary ? 0 : 1, borderColor: c.line, borderRadius: 999, paddingVertical: small ? 7 : 13, paddingHorizontal: small ? 14 : 18, alignItems: 'center', opacity: disabled ? 0.45 : pressed ? 0.75 : 1 })}>
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, c, mono: isMono, style, ...rest }) {
  return (
    <View style={{ marginBottom: 16 }}>
      {!!label && <Text style={{ color: c.muted, fontSize: 14, marginBottom: 8, marginLeft: 4 }}>{label}</Text>}
      <TextInput placeholderTextColor={c.faint} {...rest}
        style={[{ borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, color: c.text, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }, isMono ? { fontFamily: mono, letterSpacing: 2 } : null, style]} />
    </View>
  );
}

/** A grouped card with a small heading above it, like iOS settings. */
export function Group({ title, children, c, footer }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ marginBottom: 28 }}>
      {!!title && <Text style={{ color: c.muted, fontSize: 16, marginBottom: 10, marginLeft: 22 }}>{title}</Text>}
      <View style={{ backgroundColor: c.card, borderRadius: 24, overflow: 'hidden' }}>
        {items.map((ch, i) => React.cloneElement(ch, { last: i === items.length - 1 }))}
      </View>
      {!!footer && <Text style={{ color: c.muted, fontSize: 14, marginTop: 10, marginHorizontal: 22, lineHeight: 20 }}>{footer}</Text>}
    </View>
  );
}

/** One row in a Group: icon, title, optional value, chevron or a control on the right. */
export function Item({ icon, title, value, onPress, onLongPress, right, c, last, danger, subtitle, chevron }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingLeft: 18 }}>
      {icon ? <View style={{ width: 34 }}><Icon name={icon} size={21} color={danger ? c.danger : c.text} /></View> : null}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingRight: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line, marginLeft: icon ? 8 : 0 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: danger ? c.danger : c.text, fontSize: 17 }} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>}
        </View>
        {value != null && <Text style={{ color: c.muted, fontSize: 16, marginLeft: 8 }} numberOfLines={1}>{value}</Text>}
        {right}
        {(chevron || (onPress && !right && chevron !== false)) && <View style={{ marginLeft: 8 }}><Icon name="chevron-right" size={20} color={c.faint} /></View>}
      </View>
    </View>
  );
  return onPress || onLongPress ? <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={({ pressed }) => ({ backgroundColor: pressed ? c.fill : 'transparent' })}>{body}</Pressable> : body;
}

export function Empty({ text, c }) {
  return <Text style={{ color: c.muted, textAlign: 'center', marginTop: 48, paddingHorizontal: 24, fontSize: 16, lineHeight: 22 }}>{text}</Text>;
}

/** Initials for the avatar circle. */
export const initials = (name) => String(name || 'A').trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'A';
