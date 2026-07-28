import { useRef, useState } from "react";
import {
    LayoutChangeEvent,
    PanResponder,
    StyleSheet,
    Text,
    View,
} from "react-native";

interface Props {
  min: number;
  max: number;
  low: number;
  high: number;
  step?: number;
  onValueChange: (low: number, high: number) => void;
  formatLabel?: (value: number) => string;
}

const THUMB = 24;

export default function RangeSlider({
  min,
  max,
  low,
  high,
  step = 1,
  onValueChange,
  formatLabel,
}: Props) {
  const [, forceUpdate] = useState(0);

  // Use refs for everything accessed inside PanResponder to avoid stale closures
  const trackW = useRef(0);
  const lowRef = useRef(low);
  const highRef = useRef(high);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const stepRef = useRef(step);
  const cbRef = useRef(onValueChange);
  const lowStart = useRef(0);
  const highStart = useRef(0);

  lowRef.current = low;
  highRef.current = high;
  minRef.current = min;
  maxRef.current = max;
  stepRef.current = step;
  cbRef.current = onValueChange;

  const getPos = (val: number) => {
    const range = maxRef.current - minRef.current;
    return range === 0 ? 0 : ((val - minRef.current) / range) * trackW.current;
  };

  const getVal = (pos: number) => {
    const tw = trackW.current;
    if (tw === 0) return minRef.current;
    const ratio = Math.max(0, Math.min(1, pos / tw));
    const raw = minRef.current + ratio * (maxRef.current - minRef.current);
    return Math.round(raw / stepRef.current) * stepRef.current;
  };

  const lowPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lowStart.current = getPos(lowRef.current);
      },
      onPanResponderMove: (_, gs) => {
        const v = getVal(lowStart.current + gs.dx);
        const clamped = Math.max(
          minRef.current,
          Math.min(highRef.current - stepRef.current, v),
        );
        if (clamped !== lowRef.current) {
          cbRef.current(clamped, highRef.current);
        }
      },
    }),
  ).current;

  const highPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        highStart.current = getPos(highRef.current);
      },
      onPanResponderMove: (_, gs) => {
        const v = getVal(highStart.current + gs.dx);
        const clamped = Math.max(
          lowRef.current + stepRef.current,
          Math.min(maxRef.current, v),
        );
        if (clamped !== highRef.current) {
          cbRef.current(lowRef.current, clamped);
        }
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    trackW.current = e.nativeEvent.layout.width - THUMB;
    forceUpdate((n) => n + 1);
  };

  const tw = trackW.current;
  const lowRatio = max > min ? (low - min) / (max - min) : 0;
  const highRatio = max > min ? (high - min) / (max - min) : 1;
  const fmt = formatLabel ?? String;

  return (
    <View>
      <View style={styles.labels}>
        <Text style={styles.labelText}>{fmt(low)}</Text>
        <Text style={styles.labelText}>{fmt(high)}</Text>
      </View>
      <View style={styles.container} onLayout={onLayout}>
        {/* Background track */}
        <View style={[styles.trackBg, { left: THUMB / 2, right: THUMB / 2 }]} />
        {/* Filled segment */}
        <View
          style={[
            styles.trackFill,
            {
              left: lowRatio * tw + THUMB / 2,
              width: Math.max(0, (highRatio - lowRatio) * tw),
            },
          ]}
        />
        {/* Low thumb */}
        <View
          style={[styles.thumb, { left: lowRatio * tw }]}
          {...lowPan.panHandlers}
        />
        {/* High thumb */}
        <View
          style={[styles.thumb, { left: highRatio * tw }]}
          {...highPan.panHandlers}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  labelText: {
    color: "#aaaaaa",
    fontSize: 12,
  },
  container: {
    height: 44,
    justifyContent: "center",
    position: "relative",
  },
  trackBg: {
    position: "absolute",
    height: 4,
    backgroundColor: "#333333",
    borderRadius: 2,
  },
  trackFill: {
    position: "absolute",
    height: 4,
    backgroundColor: "#e8572a",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: "#ffffff",
    top: 10,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
});
