import { useState } from "react";
import {
    Modal,
    ReactNode,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { FilterState, LANGUAGE_NAMES } from "../types/filters";
import RangeSlider from "./RangeSlider";

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
  availableGenres: string[];
  availableLanguages: string[];
  availableServices: string[];
  allActors: string[];
  allDirectors: string[];
  runtimeBounds: { min: number; max: number };
}

export default function FilterModal({
  visible,
  onClose,
  filters,
  onFiltersChange,
  availableGenres,
  availableLanguages,
  availableServices,
  allActors,
  allDirectors,
  runtimeBounds,
}: Props) {
  const [actorSearch, setActorSearch] = useState("");
  const [directorSearch, setDirectorSearch] = useState("");

  const update = (changes: Partial<FilterState>) =>
    onFiltersChange({ ...filters, ...changes });

  const toggleChip = (key: keyof FilterState, value: string) => {
    const arr = filters[key] as string[];
    update({
      [key]: arr.includes(value)
        ? arr.filter((x) => x !== value)
        : [...arr, value],
    });
  };

  const clearAll = () => {
    onFiltersChange({
      genres: [],
      yearMin: "",
      yearMax: "",
      runtimeMin: runtimeBounds.min,
      runtimeMax: runtimeBounds.max,
      languages: [],
      actors: [],
      directors: [],
      streamingServices: [],
    });
    setActorSearch("");
    setDirectorSearch("");
  };

  const actorSuggestions =
    actorSearch.trim().length > 1
      ? allActors
          .filter(
            (a) =>
              a.toLowerCase().includes(actorSearch.toLowerCase()) &&
              !filters.actors.includes(a),
          )
          .slice(0, 8)
      : [];

  const directorSuggestions =
    directorSearch.trim().length > 1
      ? allDirectors
          .filter(
            (d) =>
              d.toLowerCase().includes(directorSearch.toLowerCase()) &&
              !filters.directors.includes(d),
          )
          .slice(0, 8)
      : [];

  const sliderMin = runtimeBounds.min;
  const sliderMax = Math.max(runtimeBounds.max, 300);
  const runtimeLow = Math.max(sliderMin, filters.runtimeMin);
  const runtimeHigh = Math.min(sliderMax, filters.runtimeMax);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.wrapper}>
        {/* Dimmed backdrop */}
        <TouchableOpacity
          style={styles.backdrop}
          onPress={onClose}
          activeOpacity={1}
        />

        {/* Sheet */}
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={clearAll}>
              <Text style={styles.clearText}>Clear All</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {/* Genre */}
            {availableGenres.length > 0 && (
              <Section title="Genre">
                <ChipGrid
                  options={availableGenres}
                  selected={filters.genres}
                  onToggle={(v) => toggleChip("genres", v)}
                />
              </Section>
            )}

            {/* Release Year */}
            <Section title="Release Year">
              <View style={styles.yearRow}>
                <TextInput
                  style={styles.yearInput}
                  placeholder="From"
                  placeholderTextColor="#555"
                  keyboardType="number-pad"
                  value={filters.yearMin}
                  onChangeText={(v) =>
                    update({ yearMin: v.replace(/\D/g, "") })
                  }
                  maxLength={4}
                />
                <Text style={styles.yearDash}>–</Text>
                <TextInput
                  style={styles.yearInput}
                  placeholder="To"
                  placeholderTextColor="#555"
                  keyboardType="number-pad"
                  value={filters.yearMax}
                  onChangeText={(v) =>
                    update({ yearMax: v.replace(/\D/g, "") })
                  }
                  maxLength={4}
                />
              </View>
            </Section>

            {/* Runtime */}
            {runtimeBounds.max > 0 && (
              <Section title="Runtime">
                <RangeSlider
                  min={sliderMin}
                  max={sliderMax}
                  low={runtimeLow}
                  high={runtimeHigh}
                  step={5}
                  onValueChange={(lo, hi) =>
                    update({ runtimeMin: lo, runtimeMax: hi })
                  }
                  formatLabel={(v) => `${v}m`}
                />
              </Section>
            )}

            {/* Language */}
            {availableLanguages.length > 0 && (
              <Section title="Language">
                <ChipGrid
                  options={availableLanguages}
                  selected={filters.languages}
                  onToggle={(v) => toggleChip("languages", v)}
                  labelFn={(v) => LANGUAGE_NAMES[v] ?? v.toUpperCase()}
                />
              </Section>
            )}

            {/* Streaming Service */}
            {availableServices.length > 0 && (
              <Section title="Streaming Service">
                <ChipGrid
                  options={availableServices}
                  selected={filters.streamingServices}
                  onToggle={(v) => toggleChip("streamingServices", v)}
                />
              </Section>
            )}

            {/* Actor */}
            <Section title="Actor">
              <TextInput
                style={styles.searchInput}
                placeholder="Search actors..."
                placeholderTextColor="#555"
                value={actorSearch}
                onChangeText={setActorSearch}
              />
              {actorSuggestions.map((a) => (
                <TouchableOpacity
                  key={a}
                  style={styles.suggestion}
                  onPress={() => {
                    update({ actors: [...filters.actors, a] });
                    setActorSearch("");
                  }}
                >
                  <Text style={styles.suggestionText}>{a}</Text>
                </TouchableOpacity>
              ))}
              {filters.actors.length > 0 && (
                <SelectedChips
                  items={filters.actors}
                  onRemove={(a) => toggleChip("actors", a)}
                />
              )}
            </Section>

            {/* Director */}
            <Section title="Director">
              <TextInput
                style={styles.searchInput}
                placeholder="Search directors..."
                placeholderTextColor="#555"
                value={directorSearch}
                onChangeText={setDirectorSearch}
              />
              {directorSuggestions.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={styles.suggestion}
                  onPress={() => {
                    update({ directors: [...filters.directors, d] });
                    setDirectorSearch("");
                  }}
                >
                  <Text style={styles.suggestionText}>{d}</Text>
                </TouchableOpacity>
              ))}
              {filters.directors.length > 0 && (
                <SelectedChips
                  items={filters.directors}
                  onRemove={(d) => toggleChip("directors", d)}
                />
              )}
            </Section>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={section.container}>
      <Text style={section.title}>{title}</Text>
      {children}
    </View>
  );
}

const section = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  title: {
    color: "#888888",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
});

interface ChipGridProps {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  labelFn?: (v: string) => string;
}

function ChipGrid({ options, selected, onToggle, labelFn }: ChipGridProps) {
  return (
    <View style={chip.grid}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <TouchableOpacity
            key={opt}
            style={[chip.base, active && chip.active]}
            onPress={() => onToggle(opt)}
          >
            <Text style={[chip.text, active && chip.textActive]}>
              {labelFn ? labelFn(opt) : opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const chip = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  base: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  active: { backgroundColor: "#e8572a", borderColor: "#e8572a" },
  text: { color: "#aaaaaa", fontSize: 13 },
  textActive: { color: "#ffffff", fontWeight: "600" },
});

function SelectedChips({
  items,
  onRemove,
}: {
  items: string[];
  onRemove: (v: string) => void;
}) {
  return (
    <View style={selected.row}>
      {items.map((item) => (
        <TouchableOpacity
          key={item}
          style={selected.chip}
          onPress={() => onRemove(item)}
        >
          <Text style={selected.text}>{item} ×</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const selected = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#e8572a",
  },
  text: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: "#0d0d0d",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "88%",
    paddingBottom: 34,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333333",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  headerTitle: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  clearText: { color: "#e8572a", fontSize: 14 },
  doneText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  scroll: { flex: 1 },
  yearRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  yearInput: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 10,
    color: "#ffffff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    textAlign: "center",
  },
  yearDash: { color: "#555555", fontSize: 16 },
  searchInput: {
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 10,
    color: "#ffffff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  suggestion: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  suggestionText: { color: "#ffffff", fontSize: 14 },
});
