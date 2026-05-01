import { Filter, Grid2x2, List, Search } from "lucide-react";
import type { RefreshStatus } from "../types.js";

type FilterKey = "all" | "tracks" | "albums" | "artists" | "playlists";
type ViewMode = "grid" | "list";

type SearchFilterBarProps = {
  query: string;
  selectedFilter: FilterKey;
  viewMode: ViewMode;
  filterOpen: boolean;
  refreshState?: RefreshStatus | null;
  refreshPending?: boolean;
  onQueryChange: (value: string) => void;
  onToggleFilter: () => void;
  onSelectFilter: (filter: FilterKey) => void;
  onSetViewMode: (mode: ViewMode) => void;
  onRefreshCheck: () => void;
};

const filters: FilterKey[] = ["all", "tracks", "albums", "artists", "playlists"];

export default function SearchFilterBar({
  query,
  selectedFilter,
  viewMode,
  filterOpen,
  refreshState,
  refreshPending,
  onQueryChange,
  onToggleFilter,
  onSelectFilter,
  onSetViewMode,
  onRefreshCheck
}: SearchFilterBarProps) {
  const refreshLabel =
    refreshState?.status === "downloading"
      ? "Downloading"
      : refreshState?.status === "applying"
        ? "Applying"
        : refreshState?.status === "updated"
          ? "Updated"
          : refreshState?.status === "error"
            ? "Refresh error"
            : refreshState?.status === "checking"
              ? "Checking"
              : "Catalog sync";

  return (
    <section className="search-filter-bar">
      <label className="search-filter-bar__input">
        <Search size={18} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search tracks, albums, artists..." />
      </label>

      <div className="search-filter-bar__actions">
        <button
          className={refreshState?.status === "error" ? "search-filter-bar__pill is-active" : "search-filter-bar__pill"}
          onClick={onRefreshCheck}
          disabled={refreshPending || refreshState?.status === "checking" || refreshState?.status === "downloading" || refreshState?.status === "applying"}
          title={refreshState?.message || "Check for library updates"}
        >
          {refreshPending ? "Checking…" : refreshLabel}
        </button>
        <div className="search-filter-bar__filter-wrap">
          <button className={filterOpen ? "search-filter-bar__pill is-active" : "search-filter-bar__pill"} onClick={onToggleFilter}>
            <Filter size={16} />
            Filters
          </button>
          {filterOpen ? (
            <div className="search-filter-bar__menu">
              {filters.map((filter) => (
                <button
                  key={filter}
                  className={selectedFilter === filter ? "is-active" : ""}
                  onClick={() => onSelectFilter(filter)}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          className={viewMode === "grid" ? "search-filter-bar__icon is-active" : "search-filter-bar__icon"}
          onClick={() => onSetViewMode("grid")}
          aria-label="Grid view"
        >
          <Grid2x2 size={17} />
        </button>
        <button
          className={viewMode === "list" ? "search-filter-bar__icon is-active" : "search-filter-bar__icon"}
          onClick={() => onSetViewMode("list")}
          aria-label="List view"
        >
          <List size={17} />
        </button>
      </div>
    </section>
  );
}
