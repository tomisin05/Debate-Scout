import { useState, useEffect, useMemo, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";
import Login from "./Login";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState([]);
  const [appliedFilters, setAppliedFilters] = useState([]);
  const [sortColumn, setSortColumn] = useState("school");
  const [sortDirection, setSortDirection] = useState("asc");
  const [groupBy, setGroupBy] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [visibleColumns, setVisibleColumns] = useState({
    school: true,
    team: true,
    tournament: true,
    round: true,
    side: true,
    opponent: true,
    judge: true,
    roundReport: true,
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [columnFilterMenus, setColumnFilterMenus] = useState({});
  const [columnFilters, setColumnFilters] = useState({});
  const [columnWidths, setColumnWidths] = useState({
    school: 150,
    team: 150,
    tournament: 200,
    round: 150,
    side: 130,
    opponent: 150,
    judge: 150,
    roundReport: 300,
  });
  const [selectedColumn, setSelectedColumn] = useState(null);
  const resizingRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    fetch("/data.json")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData([]));
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const getUniqueValues = (column) => {
    return [...new Set(data.map((r) => r[column]))].sort();
  };

  const matchesFilter = (value, filterType, filterValue) => {
    if (!filterValue) return true;
    value = String(value).toLowerCase();
    filterValue = filterValue.toLowerCase();

    const hasWildcard = filterValue.includes("?") || filterValue.includes("*");

    if (hasWildcard) {
      const escaped = filterValue.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(
        "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
      );
      return regex.test(value);
    }

    switch (filterType) {
      case "equals":
        return value === filterValue;
      case "contains":
        return value.includes(filterValue);
      case "notContains":
        return !value.includes(filterValue);
      case "beginsWith":
        return value.startsWith(filterValue);
      case "endsWith":
        return value.endsWith(filterValue);
      default:
        return true;
    }
  };

  useEffect(() => {
    let filtered = data.filter((row) => {
      const matchesSearch =
        !searchTerm ||
        Object.values(row).some((v) =>
          String(v).toLowerCase().includes(searchTerm.toLowerCase())
        );

      const matchesColumnFilters = Object.entries(columnFilters).every(
        ([col, selected]) => {
          if (!selected || selected.length === 0) return true;
          return selected.includes(row[col]);
        }
      );

      if (appliedFilters.length === 0)
        return matchesSearch && matchesColumnFilters;

      let result = matchesFilter(
        row[appliedFilters[0].column],
        appliedFilters[0].type,
        appliedFilters[0].value
      );

      for (let i = 1; i < appliedFilters.length; i++) {
        const match = matchesFilter(
          row[appliedFilters[i].column],
          appliedFilters[i].type,
          appliedFilters[i].value
        );
        if (appliedFilters[i].operator === "AND") {
          result = result && match;
        } else {
          result = result || match;
        }
      }

      return matchesSearch && matchesColumnFilters && result;
    });

    filtered.sort((a, b) => {
      let aVal = a[sortColumn] || "",
        bVal = b[sortColumn] || "";
      if (sortColumn === "round") {
        const aNum = parseInt(aVal.replace(/\D/g, "")) || 0;
        const bNum = parseInt(bVal.replace(/\D/g, "")) || 0;
        return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
      }
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    setFilteredData(filtered);
    setCurrentPage(1);
  }, [
    data,
    searchTerm,
    appliedFilters,
    columnFilters,
    sortColumn,
    sortDirection,
  ]);

  const handleColumnClick = (column) => {
    setSelectedColumn(selectedColumn === column ? null : column);
  };

  const copyColumnData = () => {
    if (!selectedColumn) return;
    
    const columnData = filteredData.map(row => row[selectedColumn] || '').join('\n');
    navigator.clipboard.writeText(columnData).then(() => {
      console.log('Column data copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const handleMouseDown = (e, column) => {
    e.preventDefault();
    resizingRef.current = {
      column,
      startX: e.clientX,
      startWidth: columnWidths[column],
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!resizingRef.current) return;
    const { column, startX, startWidth } = resizingRef.current;
    const diff = e.clientX - startX;
    const newWidth = Math.max(35, startWidth + diff);
    setColumnWidths((prev) => ({ ...prev, [column]: newWidth }));
  };

  const handleMouseUp = () => {
    resizingRef.current = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  const applyFilters = () => {
    setAppliedFilters([...filters]);
  };

  const toggleColumn = (column) => {
    setVisibleColumns((prev) => ({ ...prev, [column]: !prev[column] }));
  };

  const toggleAllColumns = () => {
    const allVisible = Object.values(visibleColumns).every((v) => v);
    const newState = {};
    Object.keys(visibleColumns).forEach((col) => (newState[col] = !allVisible));
    setVisibleColumns(newState);
  };

  const toggleColumnFilterMenu = (column) => {
    setColumnFilterMenus((prev) => ({ ...prev, [column]: !prev[column] }));
  };

  const toggleColumnFilterValue = (column, value) => {
    setColumnFilters((prev) => {
      const current = prev[column] || [];
      const newValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [column]: newValues };
    });
  };

  const toggleAllColumnFilterValues = (column) => {
    const values = getUniqueValues(column);
    const current = columnFilters[column] || [];
    setColumnFilters((prev) => ({
      ...prev,
      [column]: current.length === values.length ? [] : values,
    }));
  };

  const addFilter = () => {
    setFilters([
      ...filters,
      { column: "school", type: "contains", value: "", operator: "AND" },
    ]);
  };

  const updateFilter = (index, field, value) => {
    const newFilters = [...filters];
    newFilters[index][field] = value;
    setFilters(newFilters);
  };

  const removeFilter = (index) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const exportCSV = () => {
    const visibleColumnKeys = Object.entries(visibleColumns)
      .filter(([_, visible]) => visible)
      .map(([col]) => col);
    
    const headers = visibleColumnKeys.map(col => 
      col.charAt(0).toUpperCase() + col.slice(1).replace(/([A-Z])/g, " $1")
    );
    
    const csv = [
      headers.join(","),
      ...filteredData.map((row) =>
        visibleColumnKeys
          .map((col) => {
            const v = row[col] || "";
            return v.includes(",") || v.includes('"')
              ? `"${v.replace(/"/g, '""')}"`
              : v;
          })
          .join(",")
      ),
    ].join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debate-scout-filtered-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupedData = useMemo(() => {
    if (!groupBy) return null;
    return filteredData.reduce((groups, item) => {
      const key = item[groupBy] || "Unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
      return groups;
    }, {});
  }, [filteredData, groupBy]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <div className="header-left">
          <div className="app-title">
            <i className="fas fa-table"></i>
            <span>Debate Scout</span>
          </div>
        </div>
        <div className="header-right">
          <div className="search-box">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Search all records..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={exportCSV}>
            <i className="fas fa-download"></i> Export Current View
          </button>
          {selectedColumn && (
            <button className="btn-secondary" onClick={copyColumnData}>
              <i className="fas fa-copy"></i> Copy {selectedColumn.charAt(0).toUpperCase() + selectedColumn.slice(1)}
            </button>
          )}
          <button className="btn-secondary" onClick={handleLogout}>
            <i className="fas fa-sign-out-alt"></i> Logout
          </button>
          <div className="column-selector">
            <button
              className="btn-secondary"
              onClick={() => setShowColumnMenu(!showColumnMenu)}
            >
              <i className="fas fa-columns"></i> Select Columns
            </button>
            {showColumnMenu && (
              <div className="column-menu">
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={Object.values(visibleColumns).every((v) => v)}
                    onChange={toggleAllColumns}
                  />
                  <span>Select All</span>
                </label>
                <hr />
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.school}
                    onChange={() => toggleColumn("school")}
                  />
                  <span>School</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.team}
                    onChange={() => toggleColumn("team")}
                  />
                  <span>Team</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.tournament}
                    onChange={() => toggleColumn("tournament")}
                  />
                  <span>Tournament</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.round}
                    onChange={() => toggleColumn("round")}
                  />
                  <span>Round</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.side}
                    onChange={() => toggleColumn("side")}
                  />
                  <span>Side</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.opponent}
                    onChange={() => toggleColumn("opponent")}
                  />
                  <span>Opponent</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.judge}
                    onChange={() => toggleColumn("judge")}
                  />
                  <span>Judge</span>
                </label>
                <label className="column-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.roundReport}
                    onChange={() => toggleColumn("roundReport")}
                  />
                  <span>Round Report</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-controls">
          <button className="btn-add-filter" onClick={addFilter}>
            <i className="fas fa-plus"></i> Add Filter
          </button>
          {filters.length > 0 && (
            <>
              <button className="btn-apply-filters" onClick={applyFilters}>
                <i className="fas fa-check"></i> Apply Filters
              </button>
              <button
                className="btn-clear-filters"
                onClick={() => {
                  setFilters([]);
                  setAppliedFilters([]);
                }}
              >
                <i className="fas fa-times"></i> Clear All
              </button>
            </>
          )}
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="filter-select"
          >
            <option value="">No Grouping</option>
            <option value="school">Group by School</option>
            <option value="tournament">Group by Tournament</option>
            <option value="side">Group by Side</option>
          </select>
        </div>
        <div className="records-info">
          <span>{filteredData.length.toLocaleString()} records</span>
        </div>
      </div>

      {filters.length > 0 && (
        <div className="active-filters">
          {filters.map((filter, i) => (
            <div key={i}>
              {i > 0 && (
                <div className="filter-operator">
                  <label>
                    <input
                      type="radio"
                      checked={filter.operator === "AND"}
                      onChange={() => updateFilter(i, "operator", "AND")}
                    />{" "}
                    AND
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={filter.operator === "OR"}
                      onChange={() => updateFilter(i, "operator", "OR")}
                    />{" "}
                    OR
                  </label>
                </div>
              )}
              <div className="filter-row">
                <select
                  value={filter.column}
                  onChange={(e) => updateFilter(i, "column", e.target.value)}
                  className="filter-select"
                >
                  <option value="school">School</option>
                  <option value="team">Team</option>
                  <option value="tournament">Tournament</option>
                  <option value="round">Round</option>
                  <option value="side">Side</option>
                  <option value="opponent">Opponent</option>
                  <option value="judge">Judge</option>
                  <option value="roundReport">Round Report</option>
                </select>
                <select
                  value={filter.type}
                  onChange={(e) => updateFilter(i, "type", e.target.value)}
                  className="filter-select"
                >
                  <option value="contains">Contains</option>
                  <option value="notContains">Does Not Contain</option>
                  <option value="equals">Equals</option>
                  <option value="beginsWith">Begins With</option>
                  <option value="endsWith">Ends With</option>
                </select>
                <input
                  type="text"
                  value={filter.value}
                  onChange={(e) => updateFilter(i, "value", e.target.value)}
                  placeholder="Use ? for single char, * for multiple"
                  className="filter-input"
                />
                <button
                  className="btn-remove-filter"
                  onClick={() => removeFilter(i)}
                >
                  <i className="fas fa-trash"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="table-area">
        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                {Object.entries(visibleColumns)
                  .filter(([_, visible]) => visible)
                  .map(([col]) => (
                    <th
                      key={col}
                      className={`sortable ${selectedColumn === col ? 'selected-column' : ''}`}
                      style={{
                        width: columnWidths[col],
                        minWidth: columnWidths[col],
                      }}
                      onClick={() => handleColumnClick(col)}
                    >
                      <div
                        className="th-content"
                        onClick={() => handleSort(col)}
                      >
                        <span className="th-text">
                          {col.charAt(0).toUpperCase() +
                            col.slice(1).replace(/([A-Z])/g, " $1")}
                        </span>
                        <i className="fas fa-sort sort-icon"></i>
                      </div>
                      {col !== "roundReport" && (
                        <div
                          className="column-filter-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleColumnFilterMenu(col);
                          }}
                        >
                          <i className="fas fa-filter"></i>
                          {columnFilterMenus[col] && (
                            <div
                              className="column-filter-menu"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <label className="column-option">
                                <input
                                  type="checkbox"
                                  checked={
                                    (columnFilters[col] || []).length ===
                                    getUniqueValues(col).length
                                  }
                                  onChange={() =>
                                    toggleAllColumnFilterValues(col)
                                  }
                                />
                                <span>Select All</span>
                              </label>
                              <hr />
                              <div className="column-filter-list">
                                {getUniqueValues(col).map((value) => (
                                  <label
                                    key={value}
                                    className="column-option"
                                    style={{
                                      color: "#000",
                                      backgroundColor: "#fff",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={(
                                        columnFilters[col] || []
                                      ).includes(value)}
                                      onChange={() =>
                                        toggleColumnFilterValue(col, value)
                                      }
                                    />
                                    <span
                                      style={{
                                        color: "#000",
                                        fontSize: "14px",
                                        opacity: 1,
                                        visibility: "visible",
                                      }}
                                    >
                                      {value}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div
                        className="resize-handle"
                        onMouseDown={(e) => handleMouseDown(e, col)}
                      ></div>
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {groupedData ? (
                Object.entries(groupedData).map(([group, items]) => {
                  const isExpanded = expandedGroups[group];
                  const displayItems = isExpanded ? items : items.slice(0, 10);
                  return (
                    <>
                      <tr key={group} className="group-header">
                        <td
                          colSpan={
                            Object.values(visibleColumns).filter((v) => v)
                              .length
                          }
                        >
                          <strong>
                            {group} ({items.length} records)
                          </strong>
                        </td>
                      </tr>
                      {displayItems.map((row, i) => (
                        <tr key={`${group}-${i}`}>
                          {visibleColumns.school && (
                            <td
                              style={{
                                width: columnWidths.school,
                                minWidth: columnWidths.school,
                              }}
                            >
                              {row.school}
                            </td>
                          )}
                          {visibleColumns.team && (
                            <td
                              style={{
                                width: columnWidths.team,
                                minWidth: columnWidths.team,
                              }}
                            >
                              {row.team}
                            </td>
                          )}
                          {visibleColumns.tournament && (
                            <td
                              style={{
                                width: columnWidths.tournament,
                                minWidth: columnWidths.tournament,
                              }}
                            >
                              {row.tournament}
                            </td>
                          )}
                          {visibleColumns.round && (
                            <td
                              style={{
                                width: columnWidths.round,
                                minWidth: columnWidths.round,
                              }}
                            >
                              {row.round}
                            </td>
                          )}
                          {visibleColumns.side && (
                            <td
                              style={{
                                width: columnWidths.side,
                                minWidth: columnWidths.side,
                              }}
                            >
                              <span
                                className={`side-cell side-${row.side.toLowerCase()}`}
                              >
                                {row.side}
                              </span>
                            </td>
                          )}
                          {visibleColumns.opponent && (
                            <td
                              style={{
                                width: columnWidths.opponent,
                                minWidth: columnWidths.opponent,
                              }}
                            >
                              {row.opponent}
                            </td>
                          )}
                          {visibleColumns.judge && (
                            <td
                              style={{
                                width: columnWidths.judge,
                                minWidth: columnWidths.judge,
                              }}
                            >
                              {row.judge}
                            </td>
                          )}
                          {visibleColumns.roundReport && (
                            <td
                              style={{
                                width: columnWidths.roundReport,
                                minWidth: columnWidths.roundReport,
                              }}
                            >
                              {row.roundReport}
                            </td>
                          )}
                        </tr>
                      ))}
                      {items.length > 10 && (
                        <tr>
                          <td
                            colSpan={
                              Object.values(visibleColumns).filter((v) => v)
                                .length
                            }
                            style={{ textAlign: "center", padding: "10px" }}
                          >
                            <button
                              className="expand-btn"
                              onClick={() =>
                                setExpandedGroups((prev) => ({
                                  ...prev,
                                  [group]: !prev[group],
                                }))
                              }
                            >
                              {isExpanded
                                ? "Show less"
                                : `Show ${items.length - 10} more records`}
                            </button>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      Object.values(visibleColumns).filter((v) => v).length
                    }
                    className="empty-state"
                  >
                    <i className="fas fa-search"></i>
                    <div>No results found</div>
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, i) => (
                  <tr key={i}>
                    {visibleColumns.school && (
                      <td
                        className={selectedColumn === 'school' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.school,
                          minWidth: columnWidths.school,
                        }}
                      >
                        {row.school}
                      </td>
                    )}
                    {visibleColumns.team && (
                      <td
                        className={selectedColumn === 'team' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.team,
                          minWidth: columnWidths.team,
                        }}
                      >
                        {row.team}
                      </td>
                    )}
                    {visibleColumns.tournament && (
                      <td
                        className={selectedColumn === 'tournament' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.tournament,
                          minWidth: columnWidths.tournament,
                        }}
                      >
                        {row.tournament}
                      </td>
                    )}
                    {visibleColumns.round && (
                      <td
                        className={selectedColumn === 'round' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.round,
                          minWidth: columnWidths.round,
                        }}
                      >
                        {row.round}
                      </td>
                    )}
                    {visibleColumns.side && (
                      <td
                        className={selectedColumn === 'side' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.side,
                          minWidth: columnWidths.side,
                        }}
                      >
                        <span
                          className={`side-cell side-${row.side.toLowerCase()}`}
                        >
                          {row.side}
                        </span>
                      </td>
                    )}
                    {visibleColumns.opponent && (
                      <td
                        className={selectedColumn === 'opponent' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.opponent,
                          minWidth: columnWidths.opponent,
                        }}
                      >
                        {row.opponent}
                      </td>
                    )}
                    {visibleColumns.judge && (
                      <td
                        className={selectedColumn === 'judge' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.judge,
                          minWidth: columnWidths.judge,
                        }}
                      >
                        {row.judge}
                      </td>
                    )}
                    {visibleColumns.roundReport && (
                      <td
                        className={selectedColumn === 'roundReport' ? 'selected-column' : ''}
                        style={{
                          width: columnWidths.roundReport,
                          minWidth: columnWidths.roundReport,
                        }}
                      >
                        {row.roundReport}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="app-footer">
        <div className="pagination-info">
          <span>
            Showing {(currentPage - 1) * itemsPerPage + 1}-
            {Math.min(currentPage * itemsPerPage, filteredData.length)} of{" "}
            {filteredData.length.toLocaleString()}
          </span>
          <div className="items-per-page">
            <label>Items per page:</label>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>
        </div>
        <div className="pagination-controls">
          <button
            className="pagination-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <span className="page-numbers">
            Page {currentPage} of {totalPages}
          </span>
          <button
            className="pagination-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
