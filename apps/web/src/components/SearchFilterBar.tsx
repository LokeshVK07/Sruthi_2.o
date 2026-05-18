import { Filter, Grid2x2, List, RefreshCw, Search } from "lucide-react";
import type { RefreshStatus } from "../types";

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
  const status = refreshState?.status ?? "idle";
  const refreshActive =
    refreshPending || status === "checking" || status === "downloading" || status === "applying";
  const refreshTitle =
    status === "downloading"
      ? "Downloading new catalog snapshot"
      : status === "applying"
        ? "Applying new catalog snapshot"
        : status === "updated"
          ? "Catalog up to date"
          : status === "error"
            ? refreshState?.message || "Last refresh failed — click to retry"
            : status === "checking"
              ? "Checking for library updates"
              : refreshState?.message || "Check for library updates";
  const refreshClasses = [
    "search-filter-bar__icon",
    "search-filter-bar__refresh",
    refreshActive ? "is-spinning" : "",
    status === "error" ? "is-error" : "",
    status === "updated" ? "is-success" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="search-filter-bar">
      <label className="search-filter-bar__input">
        <Search size={16} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search tracks, albums, artists..." />
      </label>

      <div className="search-filter-bar__actions">
        <button
          type="button"
          className={refreshClasses}
          onClick={onRefreshCheck}
          disabled={refreshActive}
          title={refreshTitle}
          aria-label={refreshTitle}
        >
          <RefreshCw size={15} />
        </button>
        <div className="search-filter-bar__filter-wrap">
          <button className={filterOpen ? "search-filter-bar__pill is-active" : "search-filter-bar__pill"} onClick={onToggleFilter}>
            <Filter size={14} />
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
          <Grid2x2 size={15} />
        </button>
        <button
          className={viewMode === "list" ? "search-filter-bar__icon is-active" : "search-filter-bar__icon"}
          onClick={() => onSetViewMode("list")}
          aria-label="List view"
        >
          <List size={15} />
        </button>
      </div>
    </section>
  );
}
