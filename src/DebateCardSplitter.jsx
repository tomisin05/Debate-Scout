import React, { useState, useEffect, useRef } from 'react';

const DebateCardSplitter = () => {
  const [docs, setDocs] = useState(new Map());
  const [cards, setCards] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState('all');
  const [docFilter, setDocFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('doc');
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  const [nextDocId, setNextDocId] = useState(1);
  const [nextCardId, setNextCardId] = useState(1);
  const [libLoading, setLibLoading] = useState(true);

  const fileInputRef = useRef(null);
  const leftPaneRef = useRef(null);

  // Enhanced Search Engine
  class SearchEngine {
    constructor() {
      this.stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
    }

    parseQuery(query) {
      if (!query.trim()) return { type: 'empty' };
      
      const phraseMatch = query.match(/^"(.+)"$/);
      if (phraseMatch) {
        return { type: 'phrase', phrase: phraseMatch[1].toLowerCase() };
      }

      if (query.includes(' AND ') || query.includes(' OR ')) {
        return this.parseBooleanQuery(query);
      }

      const exclusions = [];
      const inclusions = [];
      const fuzzyTerms = [];
      
      const tokens = query.split(/\s+/);
      for (const token of tokens) {
        if (token.startsWith('-') && token.length > 1) {
          exclusions.push(token.substring(1).toLowerCase());
        } else if (token.endsWith('~') && token.length > 1) {
          fuzzyTerms.push(token.substring(0, token.length - 1).toLowerCase());
        } else if (token.trim()) {
          inclusions.push(token.toLowerCase());
        }
      }

      return { type: 'advanced', inclusions, exclusions, fuzzyTerms };
    }

    parseBooleanQuery(query) {
      const terms = [];
      const parts = query.split(/(\s+(?:AND|OR)\s+)/i);
      
      for (let i = 0; i < parts.length; i += 2) {
        const term = parts[i].trim().toLowerCase();
        const operator = i + 1 < parts.length ? parts[i + 1].trim().toUpperCase() : null;
        
        if (term) {
          terms.push({ term, operator: operator === 'AND' ? 'AND' : 'OR' });
        }
      }

      return { type: 'boolean', terms };
    }

    searchCard(card, query, scope) {
      const parsedQuery = this.parseQuery(query);
      
      if (parsedQuery.type === 'empty') return { matches: true, score: 0 };

      const searchFields = this.getSearchFields(card, scope);
      
      switch (parsedQuery.type) {
        case 'phrase':
          return this.searchPhrase(searchFields, parsedQuery.phrase);
        case 'boolean':
          return this.searchBoolean(searchFields, parsedQuery.terms);
        case 'advanced':
          return this.searchAdvanced(searchFields, parsedQuery);
        default:
          return { matches: false, score: 0 };
      }
    }

    getSearchFields(card, scope) {
      switch (scope) {
        case 'tag': return [card.searchTag];
        case 'cite': return [card.searchCite];
        case 'body': return [card.searchBody];
        default: return [card.searchAll];
      }
    }

    searchPhrase(fields, phrase) {
      for (const field of fields) {
        if (field.includes(phrase)) {
          const position = field.indexOf(phrase);
          const score = 100 - (position / field.length * 50) + (phrase.length / field.length * 50);
          return { matches: true, score: Math.max(score, 10) };
        }
      }
      return { matches: false, score: 0 };
    }

    searchBoolean(fields, terms) {
      let result = null;
      let totalScore = 0;
      
      for (const { term, operator } of terms) {
        const termResult = this.searchTerm(fields, term);
        
        if (result === null) {
          result = termResult.matches;
          totalScore = termResult.score;
        } else if (operator === 'AND') {
          result = result && termResult.matches;
          totalScore = Math.min(totalScore, termResult.score);
        } else {
          result = result || termResult.matches;
          totalScore = Math.max(totalScore, termResult.score);
        }
      }
      
      return { matches: result || false, score: totalScore };
    }

    searchAdvanced(fields, query) {
      let score = 0;
      let hasMatches = false;

      for (const term of query.inclusions) {
        const result = this.searchTerm(fields, term);
        if (!result.matches) return { matches: false, score: 0 };
        score += result.score;
        hasMatches = true;
      }

      for (const term of query.fuzzyTerms) {
        const result = this.searchFuzzy(fields, term);
        if (result.matches) {
          score += result.score * 0.8;
          hasMatches = true;
        }
      }

      for (const term of query.exclusions) {
        const result = this.searchTerm(fields, term);
        if (result.matches) return { matches: false, score: 0 };
      }

      return { matches: hasMatches || query.inclusions.length === 0, score };
    }

    searchTerm(fields, term) {
      for (const field of fields) {
        if (field.includes(term)) {
          const occurrences = (field.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          const density = occurrences / field.split(' ').length;
          const position = field.indexOf(term);
          const positionScore = 100 - (position / field.length * 30);
          const score = (density * 100) + (positionScore * 0.3) + (term.length * 2);
          return { matches: true, score: Math.max(score, 5) };
        }
      }
      return { matches: false, score: 0 };
    }

    searchFuzzy(fields, term) {
      const threshold = 0.7;
      
      for (const field of fields) {
        const words = field.split(/\s+/);
        for (const word of words) {
          if (this.similarity(term, word) >= threshold) {
            const score = this.similarity(term, word) * 50;
            return { matches: true, score };
          }
        }
      }
      return { matches: false, score: 0 };
    }

    similarity(a, b) {
      const matrix = [];
      const aLen = a.length;
      const bLen = b.length;

      if (aLen === 0) return bLen === 0 ? 1 : 0;
      if (bLen === 0) return 0;

      for (let i = 0; i <= bLen; i++) {
        matrix[i] = [i];
      }

      for (let j = 0; j <= aLen; j++) {
        matrix[0][j] = j;
      }

      for (let i = 1; i <= bLen; i++) {
        for (let j = 1; j <= aLen; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
          }
        }
      }

      const distance = matrix[bLen][aLen];
      return 1 - distance / Math.max(aLen, bLen);
    }
  }

  const searchEngine = new SearchEngine();

  useEffect(() => {
    // Simulate library loading
    const timer = setTimeout(() => {
      setLibLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleFileUpload = (files) => {
    console.log('Files uploaded:', files.length);
    // File processing would go here
  };

  const applyFilters = () => {
    const q = search.trim();
    const docFilterId = docFilter ? Number(docFilter) : null;

    let result = [];
    
    for (const card of cards) {
      if (docFilterId && card.docId !== docFilterId) continue;
      if (sectionFilter && card.section !== sectionFilter) continue;
      
      const searchResult = searchEngine.searchCard(card, q, searchScope);
      if (searchResult.matches) {
        result.push({ ...card, searchScore: searchResult.score });
      }
    }

    if (sortOrder === 'relevance' && q) {
      result.sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0));
    } else if (sortOrder === 'alpha') {
      result.sort((a, b) => a.author.localeCompare(b.author));
    } else if (sortOrder === 'taglen') {
      result.sort((a, b) => a.tag.length - b.tag.length);
    } else {
      result.sort((a, b) => a.docId - b.docId || a.id - b.id);
    }

    setFiltered(result);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      applyFilters();
    }, 120);
    return () => clearTimeout(timer);
  }, [search, searchScope, docFilter, sectionFilter, sortOrder, cards]);

  const highlightMatches = (text, query) => {
    if (!query.trim()) return text;
    
    const parsedQuery = searchEngine.parseQuery(query);
    
    switch (parsedQuery.type) {
      case 'phrase':
        return highlightPhrase(text, parsedQuery.phrase);
      case 'boolean':
        return highlightBoolean(text, parsedQuery.terms);
      case 'advanced':
        return highlightAdvanced(text, parsedQuery);
      default:
        return text;
    }
  };

  const highlightPhrase = (text, phrase) => {
    const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${safe})`, 'gi'), '<mark style="background:#fff39a;padding:0 1px;">$1</mark>');
  };

  const highlightBoolean = (text, terms) => {
    let result = text;
    for (const { term } of terms) {
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(${safe})`, 'gi'), '<mark style="background:#b6f0ee;padding:0 1px;">$1</mark>');
    }
    return result;
  };

  const highlightAdvanced = (text, query) => {
    let result = text;
    
    for (const term of query.inclusions) {
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(${safe})`, 'gi'), '<mark style="background:#fff39a;padding:0 1px;">$1</mark>');
    }
    
    for (const term of query.fuzzyTerms) {
      const words = result.split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const cleanWord = words[i].replace(/<[^>]*>/g, '').toLowerCase();
        if (searchEngine.similarity(term, cleanWord) >= 0.7) {
          const safe = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          result = result.replace(new RegExp(`\\b(${safe})\\b`, 'gi'), '<mark style="background:#b8d4ff;padding:0 1px;">$1</mark>');
        }
      }
    }
    
    return result;
  };

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateRows: 'auto auto 1fr', 
      height: '100vh', 
      maxHeight: '100vh', 
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      color: '#1f1e1d',
      background: '#ffffff'
    }}>
      {/* Library Loading Banner */}
      {libLoading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: '#e8f0fe', borderBottom: '0.5px solid #6f8bd6',
          padding: '8px 20px', fontSize: '12px', color: '#2a4fa3',
          display: 'flex', alignItems: 'center', gap: '8px', zIndex: 100
        }}>
          <div style={{
            width: '12px', height: '12px', border: '1.5px solid #a0b4e8',
            borderTopColor: '#2a4fa3', borderRadius: '50%',
            animation: 'spin 0.7s linear infinite'
          }}></div>
          Loading document renderer...
        </div>
      )}

      {/* Top Bar */}
      <div style={{
        padding: '14px 20px', borderBottom: '0.5px solid #e3e1d8',
        display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap',
        marginTop: libLoading ? '37px' : '0'
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
          Debate Card Splitter <span style={{ color: '#5e5d59', fontWeight: 400, marginLeft: '4px' }}>multi-doc</span>
        </h1>
        <button 
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: '#1f1e1d', color: '#ffffff', border: 'none',
            borderRadius: '6px', padding: '7px 12px', fontSize: '13px', cursor: 'pointer'
          }}
        >
          + Add documents
        </button>
        <input 
          ref={fileInputRef}
          id="file-input"
          name="file-input"
          type="file" 
          accept=".docx" 
          multiple 
          style={{ display: 'none' }}
          onChange={(e) => handleFileUpload(Array.from(e.target.files || []))}
          aria-label="Upload DOCX files"
        />
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#5e5d59', marginLeft: 'auto' }}>
          <span><b style={{ color: '#1f1e1d', fontWeight: 600, marginRight: '4px', fontSize: '13px' }}>{docs.size}</b>documents</span>
          <span><b style={{ color: '#1f1e1d', fontWeight: 600, marginRight: '4px', fontSize: '13px' }}>{cards.length}</b>cards</span>
          <span><b style={{ color: '#1f1e1d', fontWeight: 600, marginRight: '4px', fontSize: '13px' }}>{filtered.length}</b>shown</span>
        </div>
      </div>

      {/* Search Row */}
      <div style={{
        padding: '12px 20px', borderBottom: '0.5px solid #e3e1d8',
        display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap'
      }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <label htmlFor="search-input" style={{ position: 'absolute', left: '-9999px' }}>Search debate cards</label>
          <span style={{
            position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)',
            fontSize: '16px', color: '#8a8983', pointerEvents: 'none'
          }}>🔍</span>
          <input 
            id="search-input"
            name="search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search: "exact phrase", word1 AND word2, word1 OR word2, -exclude, fuzzy~'
            aria-label="Search debate cards"
            style={{
              width: '100%', padding: '9px 40px 9px 34px',
              border: '0.5px solid #c9c7be', borderRadius: '6px',
              fontSize: '14px', background: '#ffffff', color: '#1f1e1d', outline: 'none'
            }}
          />
          <button 
            id="search-help"
            onClick={() => setShowSearchHelp(!showSearchHelp)}
            aria-label="Show search help"
            aria-expanded={showSearchHelp}
            style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              width: '20px', height: '20px', borderRadius: '50%',
              background: '#f6f5f1', color: '#8a8983', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ?
          </button>
          {showSearchHelp && (
            <div style={{
              position: 'absolute', top: '100%', right: '0', marginTop: '8px',
              background: '#1f1e1d', color: '#ffffff', padding: '12px 16px',
              borderRadius: '6px', fontSize: '12px', lineHeight: '1.4',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, minWidth: '300px'
            }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600 }}>Advanced Search</h4>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                <li style={{ marginBottom: '4px' }}><code style={{ background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: '2px' }}>"climate change"</code> - Exact phrase</li>
                <li style={{ marginBottom: '4px' }}><code style={{ background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: '2px' }}>climate AND change</code> - Both words required</li>
                <li style={{ marginBottom: '4px' }}><code style={{ background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: '2px' }}>climate OR warming</code> - Either word</li>
                <li style={{ marginBottom: '4px' }}><code style={{ background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: '2px' }}>climate -denial</code> - Include climate, exclude denial</li>
                <li style={{ marginBottom: '4px' }}><code style={{ background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: '2px' }}>climat~</code> - Fuzzy match (climate, climatic, etc.)</li>
              </ul>
            </div>
          )}
        </div>
        
        <div style={{
          display: 'inline-flex', gap: '4px', background: '#f6f5f1',
          padding: '3px', borderRadius: '6px'
        }} role="tablist" aria-label="Search scope">
          {['all', 'tag', 'cite', 'body'].map(scope => (
            <button
              key={scope}
              onClick={() => setSearchScope(scope)}
              role="tab"
              aria-selected={searchScope === scope}
              aria-label={`Search in ${scope === 'all' ? 'all fields' : scope}`}
              style={{
                border: 'none', background: searchScope === scope ? '#ffffff' : 'transparent',
                padding: '5px 10px', fontSize: '12px', borderRadius: '4px',
                cursor: 'pointer', color: searchScope === scope ? '#1f1e1d' : '#5e5d59',
                boxShadow: searchScope === scope ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              {scope.charAt(0).toUpperCase() + scope.slice(1)}
            </button>
          ))}
        </div>

        <label htmlFor="sort-order" style={{ position: 'absolute', left: '-9999px' }}>Sort order</label>

        <select 
          id="sort-order"
          name="sort-order"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          aria-label="Sort order"
          style={{
            fontSize: '13px', padding: '8px 10px', borderRadius: '6px',
            border: '0.5px solid #c9c7be', background: '#ffffff',
            color: '#1f1e1d', maxWidth: '220px'
          }}
        >
          <option value="doc">Document order</option>
          <option value="alpha">Author (A–Z)</option>
          <option value="taglen">Tag length</option>
          <option value="relevance">Relevance</option>
        </select>
      </div>

      {/* Main Content */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(340px, 460px) 1fr',
        minHeight: 0, overflow: 'hidden'
      }}>
        {/* Left Pane */}
        <div ref={leftPaneRef} style={{
          borderRight: '0.5px solid #e3e1d8', overflowY: 'auto',
          minHeight: 0, background: '#f6f5f1'
        }}>
          <div style={{
            position: 'sticky', top: 0, background: '#f6f5f1',
            padding: '10px 14px', borderBottom: '0.5px solid #e3e1d8',
            fontSize: '12px', color: '#5e5d59',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2
          }}>
            <span>No documents uploaded</span>
          </div>
          
          <div style={{ padding: '60px 30px', textAlign: 'center', color: '#8a8983', fontSize: '13px' }}>
            <span style={{ fontSize: '28px', display: 'block', marginBottom: '10px', color: '#5e5d59' }}>📄</span>
            Upload .docx files to get started.
            <br /><br />
            <button 
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: '#1f1e1d', color: '#ffffff', border: 'none',
                borderRadius: '6px', padding: '7px 12px', fontSize: '13px', cursor: 'pointer',
                marginTop: '16px'
              }}
            >
              + Add documents
            </button>
          </div>
        </div>

        {/* Right Pane */}
        <div style={{
          display: 'grid', gridTemplateRows: 'auto 1fr auto',
          minHeight: 0, overflow: 'hidden'
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', padding: '60px 30px',
            textAlign: 'center', color: '#8a8983', fontSize: '13px'
          }}>
            <span style={{ fontSize: '28px', display: 'block', marginBottom: '10px', color: '#5e5d59' }}>←</span>
            Select a card from the list to view it here.
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default DebateCardSplitter;