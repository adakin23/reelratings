import { useEffect, useState } from "react";
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
import { supabase } from "../lib/supabase";
import { FilterState, LANGUAGE_NAMES } from "../types/filters";
import RangeSlider from "./RangeSlider";

const STATUS_OPTIONS = [
  { value: "watched", label: "Watched" },
  { value: "watchlist", label: "Watchlist" },
  { value: "undiscovered", label: "Undiscovered" },
];

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
  showStatusFilter?: boolean; // only shown on Discover screen
  onSetDefault?: () => void;
  onClearDefault?: () => void;
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
  showStatusFilter = false,
  onSetDefault,
  onClearDefault,
}: Props) {
  // Searchable dropdown state
  const [genreSearch, setGenreSearch] = useState("");
  const [genreOpen, setGenreOpen] = useState(false);
  const [langSearch, setLangSearch] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceOpen, setServiceOpen] = useState(false);

  // Actor / Director / Username search state
  const [actorSearch, setActorSearch] = useState("");
  const [directorSearch, setDirectorSearch] = useState("");
  const [usernameSearch, setUsernameSearch] = useState("");
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [defaultSaved, setDefaultSaved] = useState(false);

  useEffect(() => {
    if (usernameSearch.trim().length < 2) {
      setUsernameSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .ilike("username", `${usernameSearch}%`)
        .limit(8);
      if (data) {
        setUsernameSuggestions(
          data
            .map((p: any) => p.username)
            .filter(
              (u: string) => u && !filters.sharedWithUsernames.includes(u),
            ),
        );
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [usernameSearch, filters.sharedWithUsernames]);

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
      sharedWithUsernames: [],
      statuses: [],
    });
    setGenreSearch("");
    setGenreOpen(false);
    setLangSearch("");
    setLangOpen(false);
    setServiceSearch("");
    setServiceOpen(false);
    setActorSearch("");
    setDirectorSearch("");
    setUsernameSearch("");
    setUsernameSuggestions([]);
    onClearDefault?.();
  };

  const handleSetDefault = () => {
    onSetDefault?.();
    setDefaultSaved(true);
    setTimeout(() => setDefaultSaved(false), 2000);
  };

  // Actor / Director suggestions (require 2+ chars, same as before)
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
        <TouchableOpacity
          style={styles.backdrop}
          onPress={onClose}
          activeOpacity={1}
        />

        <View style={styles.sheet}>
          <View style={styles.handle} />

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
            {/* ── Library Status (Discover only) ── */}
            {showStatusFilter && (
              <Section title="Library Status">
                <View style={styles.statusRow}>
                  {STATUS_OPTIONS.map((opt) => {
                    const active = filters.statuses.includes(opt.value);
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.statusChip,
                          active && styles.statusChipActive,
                        ]}
                        onPress={() => toggleChip("statuses", opt.value)}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            active && styles.statusChipTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>
            )}

            {/* ── Genre ── */}
            {availableGenres.length > 0 && (
              <Section title="Genre">
                <SearchableDropdown
                  placeholder="Search genres..."
                  options={availableGenres}
                  selected={filters.genres}
                  onToggle={(v) => toggleChip("genres", v)}
                  searchValue={genreSearch}
                  onSearchChange={setGenreSearch}
                  isOpen={genreOpen}
                  onOpen={() => setGenreOpen(true)}
                  onClose={() => setTimeout(() => setGenreOpen(false), 150)}
                />
              </Section>
            )}

            {/* ── Release Year ── */}
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

            {/* ── Runtime ── */}
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

            {/* ── Language ── */}
            {availableLanguages.length > 0 && (
              <Section title="Language">
                <SearchableDropdown
                  placeholder="Search languages..."
                  options={availableLanguages}
                  selected={filters.languages}
                  onToggle={(v) => toggleChip("languages", v)}
                  labelFn={(v) => LANGUAGE_NAMES[v] ?? v.toUpperCase()}
                  searchValue={langSearch}
                  onSearchChange={setLangSearch}
                  isOpen={langOpen}
                  onOpen={() => setLangOpen(true)}
                  onClose={() => setTimeout(() => setLangOpen(false), 150)}
                />
              </Section>
            )}

            {/* ── Streaming Service ── */}
            {availableServices.length > 0 && (
              <Section title="Streaming Service">
                <SearchableDropdown
                  placeholder="Search streaming services..."
                  options={availableServices}
                  selected={filters.streamingServices}
                  onToggle={(v) => toggleChip("streamingServices", v)}
                  searchValue={serviceSearch}
                  onSearchChange={setServiceSearch}
                  isOpen={serviceOpen}
                  onOpen={() => setServiceOpen(true)}
                  onClose={() => setTimeout(() => setServiceOpen(false), 150)}
                />
              </Section>
            )}

            {/* ── Actor ── */}
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

            {/* ── Director ── */}
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

            {/* ── Friends' Watchlists ── */}
            <Section title="Friends' Watchlists">
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username..."
                placeholderTextColor="#555"
                value={usernameSearch}
                onChangeText={setUsernameSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {usernameSuggestions.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={styles.suggestion}
                  onPress={() => {
                    update({
                      sharedWithUsernames: [...filters.sharedWithUsernames, u],
                    });
                    setUsernameSearch("");
                    setUsernameSuggestions([]);
                  }}
                >
                  <Text style={styles.suggestionText}>@{u}</Text>
                </TouchableOpacity>
              ))}
              {filters.sharedWithUsernames.length > 0 && (
                <SelectedChips
                  items={filters.sharedWithUsernames.map((u) => `@${u}`)}
                  onRemove={(u) =>
                    toggleChip("sharedWithUsernames", u.replace("@", ""))
                  }
                />
              )}
              {filters.sharedWithUsernames.length > 1 && (
                <Text style={styles.andNote}>
                  Showing movies on all {filters.sharedWithUsernames.length + 1}{" "}
                  watchlists
                </Text>
              )}
            </Section>

            {/* ── Set as Default ── */}
            <View style={styles.setDefaultRow}>
              <TouchableOpacity
                style={[
                  styles.setDefaultBtn,
                  defaultSaved && styles.setDefaultBtnSaved,
                ]}
                onPress={handleSetDefault}
                disabled={defaultSaved}
              >
                <Text style={styles.setDefaultText}>
                  {defaultSaved ? "✓ Default Saved" : "Set as Default"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.setDefaultNote}>
                These filters will be applied automatically each time you open
                the app. Clear All to remove.
              </Text>
            </View>

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

// Searchable dropdown — shows full list on focus, filters as user types
interface SearchableDropdownProps {
  placeholder: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  labelFn?: (v: string) => string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function SearchableDropdown({
  placeholder,
  options,
  selected,
  onToggle,
  labelFn,
  searchValue,
  onSearchChange,
  isOpen,
  onOpen,
  onClose,
}: SearchableDropdownProps) {
  const label = (v: string) => (labelFn ? labelFn(v) : v);

  const filtered = searchValue.trim()
    ? options.filter((o) =>
        label(o).toLowerCase().includes(searchValue.toLowerCase()),
      )
    : options;

  return (
    <View>
      <TextInput
        style={dropdown.input}
        placeholder={placeholder}
        placeholderTextColor="#555"
        value={searchValue}
        onChangeText={onSearchChange}
        onFocus={onOpen}
        onBlur={onClose}
      />

      {isOpen && (
        <ScrollView
          style={dropdown.list}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {filtered.length === 0 ? (
            <Text style={dropdown.noResults}>No results</Text>
          ) : (
            filtered.map((opt) => {
              const active = selected.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={dropdown.option}
                  onPress={() => onToggle(opt)}
                >
                  <Text
                    style={[
                      dropdown.optionText,
                      active && dropdown.optionTextActive,
                    ]}
                  >
                    {label(opt)}
                  </Text>
                  {active && <Text style={dropdown.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {selected.length > 0 && (
        <SelectedChips items={selected} onRemove={onToggle} labelFn={labelFn} />
      )}
    </View>
  );
}

const dropdown = StyleSheet.create({
  input: {
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 10,
    color: "#ffffff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  list: {
    maxHeight: 180,
    backgroundColor: "#111111",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    marginTop: 4,
  },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  optionText: { color: "#aaaaaa", fontSize: 14 },
  optionTextActive: { color: "#ffffff", fontWeight: "600" },
  checkmark: { color: "#e8572a", fontSize: 14, fontWeight: "700" },
  noResults: {
    color: "#555555",
    fontSize: 13,
    padding: 12,
    fontStyle: "italic",
  },
});

function SelectedChips({
  items,
  onRemove,
  labelFn,
}: {
  items: string[];
  onRemove: (v: string) => void;
  labelFn?: (v: string) => string;
}) {
  return (
    <View style={selected.row}>
      {items.map((item) => (
        <TouchableOpacity
          key={item}
          style={selected.chip}
          onPress={() => onRemove(item)}
        >
          <Text style={selected.text}>{labelFn ? labelFn(item) : item} ×</Text>
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
  statusRow: {
    flexDirection: "row",
    gap: 8,
  },
  statusChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    alignItems: "center",
  },
  statusChipActive: { backgroundColor: "#e8572a", borderColor: "#e8572a" },
  statusChipText: { color: "#aaaaaa", fontSize: 13, fontWeight: "600" },
  statusChipTextActive: { color: "#ffffff" },
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
  andNote: {
    color: "#555555",
    fontSize: 12,
    marginTop: 8,
    fontStyle: "italic",
  },
  setDefaultRow: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 10,
  },
  setDefaultBtn: {
    backgroundColor: "#e8572a",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  setDefaultBtnSaved: {
    backgroundColor: "#2a5c2a",
  },
  setDefaultText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  setDefaultNote: {
    color: "#555555",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});
