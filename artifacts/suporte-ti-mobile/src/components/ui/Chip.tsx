import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radius, spacing } from "../../theme";

export function Chip({
  label,
  selected,
  onPress,
  selectedColor,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  selectedColor?: string;
}) {
  const bg = selected ? selectedColor ?? colors.primary : colors.surface;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: bg, borderColor: selected ? bg : colors.border }]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
  labelSelected: { color: "#fff" },
});
