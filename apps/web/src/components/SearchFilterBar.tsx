import { Filter, Grid2x2, List, Search } from "lucide-react";

type FilterKey = "all" | "tracks" | "albums" | "artists" | "playlists";
type ViewMode = "grid" | "list";

type SearchFilterBarProps = {
  query: string;
  selectedFilter: FilterKey;
  viewMode: ViewMode;
  filterOpen: boolean;
  onQueryChange: (value: string) => void;
  onToggleFilter: () => void;
  onSelectFilter: (filter: FilterKey) => void;
  onSetViewMode: (mode: ViewMode) => void;
};

const filters: FilterKey[] = ["all", "tracks", "albums", "artists", "playlists"];

export default function SearchFilterBar({
  query,
  selectedFilter,
  viewMode,
  filterOpen,
  onQueryChange,
  onToggleFilter,
  onSelectFilter,
  onSetViewMode
}: SearchFilterBarProps) {
  return (
    <section className="search-filter-bar">
      <label className="search-filter-bar__input">
        <Search size={18} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search tracks, albums, artists..." />
      </label>

      <div className="search-filter-bar__actions">
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
