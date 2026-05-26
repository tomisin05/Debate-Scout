import React, { useState, useEffect } from 'react';

const DebateCardSplitter = () => {
  const [cards, setCards] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState('all');
  const [sortOrder, setSortOrder] = useState('doc');
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);

  // Mock data for demonstration
  const mockCards = [
    {
      id: 1,
      docName: "Climate Policy 2024",
      section: "Impacts",
      tag: "Climate change causes extinction through multiple pathways",
      cite: "Hansen 24 (James, NASA Climate Scientist, \"Accelerating Climate Crisis,\" Nature Climate Change, March 2024)",
      bodyPlain: "Climate change represents an existential threat to human civilization through multiple interconnected pathways. Rising temperatures trigger cascading feedback loops that accelerate warming beyond human control. Sea level rise displaces billions, creating unprecedented refugee crises. Extreme weather events destroy infrastructure and agricultural systems. Ocean acidification collapses marine ecosystems that billions depend on for protein. The combination of these factors creates a perfect storm for civilizational collapse.",
      searchTag: "climate change causes extinction through multiple pathways",
      searchCite: "hansen 24 (james, nasa climate scientist, \"accelerating climate crisis,\" nature climate change, march 2024)",
      searchBody: "climate change represents an existential threat to human civilization through multiple interconnected pathways. rising temperatures trigger cascading feedback loops that accelerate warming beyond human control. sea level rise displaces billions, creating unprecedented refugee crises. extreme weather events destroy infrastructure and agricultural systems. ocean acidification collapses marine ecosystems that billions depend on for protein. the combination of these factors creates a perfect storm for civilizational collapse.",
      searchAll: "climate change causes extinction through multiple pathways hansen 24 (james, nasa climate scientist, \"accelerating climate crisis,\" nature climate change, march 2024) climate change represents an existential threat to human civilization through multiple interconnected pathways. rising temperatures trigger cascading feedback loops that accelerate warming beyond human control. sea level rise displaces billions, creating unprecedented refugee crises. extreme weather events destroy infrastructure and agricultural systems. ocean acidification collapses marine ecosystems that billions depend on for protein. the combination of these factors creates a perfect storm for civilizational collapse.",
      author: "Hansen"
    },
    {
      id: 2,
      docName: "Energy Transition",
      section: "Solutions",
      tag: "Renewable energy transition is technically feasible and economically viable",
      cite: "Jacobson 23 (Mark, Stanford University, \"100% Clean Energy Roadmap,\" Energy Policy, December 2023)",
      bodyPlain: "A complete transition to renewable energy is not only technically feasible but economically advantageous. Wind, water, and solar technologies can provide 100% of global energy needs by 2035. The transition would create 28 million more jobs than it eliminates. Total system costs would be 63% lower than business-as-usual scenarios. Grid stability can be maintained through smart grid technologies and energy storage. The primary barriers are political, not technological or economic.",
      searchTag: "renewable energy transition is technically feasible and economically viable",
      searchCite: "jacobson 23 (mark, stanford university, \"100% clean energy roadmap,\" energy policy, december 2023)",
      searchBody: "a complete transition to renewable energy is not only technically feasible but economically advantageous. wind, water, and solar technologies can provide 100% of global energy needs by 2035. the transition would create 28 million more jobs than it eliminates. total system costs would be 63% lower than business-as-usual scenarios. grid stability can be maintained through smart grid technologies and energy storage. the primary barriers are political, not technological or economic.",
      searchAll: "renewable energy transition is technically feasible and economically viable jacobson 23 (mark, stanford university, \"100% clean energy roadmap,\" energy policy, december 2023) a complete transition to renewable energy is not only technically feasible but economically advantageous. wind, water, and solar technologies can provide 100% of global energy needs by 2035. the transition would create 28 million more jobs than it eliminates. total system costs would be 63% lower than business-as-usual scenarios. grid stability can be maintained through smart grid technologies and energy storage. the primary barriers are political, not technological or economic.",
      author: "Jacobson"
    },
    {
      id: 3,
      docName: "Nuclear Policy",
      section: "Deterrence",
      tag: "Nuclear weapons modernization increases first-strike capabilities",
      cite: "Kristensen 24 (Hans, Federation of American Scientists, \"Nuclear Modernization Trends,\" Bulletin of Atomic Scientists, January 2024)",
      bodyPlain: "Current nuclear modernization programs are fundamentally altering the strategic balance by enhancing first-strike capabilities. New low-yield warheads lower the threshold for nuclear use. Hypersonic delivery systems compress decision-making timeframes to minutes. Improved accuracy makes counterforce strikes more feasible. These developments undermine crisis stability and increase the likelihood of nuclear conflict through miscalculation or technical failure.",
      searchTag: "nuclear weapons modernization increases first-strike capabilities",
      searchCite: "kristensen 24 (hans, federation of american scientists, \"nuclear modernization trends,\" bulletin of atomic scientists, january 2024)",
      searchBody: "current nuclear modernization programs are fundamentally altering the strategic balance by enhancing first-strike capabilities. new low-yield warheads lower the threshold for nuclear use. hypersonic delivery systems compress decision-making timeframes to minutes. improved accuracy makes counterforce strikes more feasible. these developments undermine crisis stability and increase the likelihood of nuclear conflict through miscalculation or technical failure.",
      searchAll: "nuclear weapons modernization increases first-strike capabilities kristensen 24 (hans, federation of american scientists, \"nuclear modernization trends,\" bulletin of atomic scientists, january 2024) current nuclear modernization programs are fundamentally altering the strategic balance by enhancing first-strike capabilities. new low-yield warheads lower the threshold for nuclear use. hypersonic delivery systems compress decision-making timeframes to minutes. improved accuracy makes counterforce strikes more feasible. these developments undermine crisis stability and increase the likelihood of nuclear conflict through miscalculation or technical failure.",
      author: "Kristensen"
    }
  ];

  // Enhanced Search Engine
  class SearchEngine {
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
    setCards(mockCards);
    setFiltered(mockCards);
  }, []);

  const applyFilters = () => {
    const q = search.trim();
    let result = [];
    
    for (const card of cards) {
      const searchResult = searchEngine.searchCard(card, q, searchScope);
      if (searchResult.matches) {
        result.push({ ...card, searchScore: searchResult.score });
      }
    }

    if (sortOrder === 'relevance' && q) {
      result.sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0));
    } else if (sortOrder === 'alpha') {
      result.sort((a, b) => a.author.localeCompare(b.author));
    } else {
      result.sort((a, b) => a.id - b.id);
    }

    setFiltered(result);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      applyFilters();
    }, 120);
    return () => clearTimeout(timer);
  }, [search, searchScope, sortOrder, cards]);

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
    
    return result;
  };

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateRows: 'auto auto 1fr', 
      height: '100vh', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#1f1e1d',
      background: '#ffffff'
    }}>
      {/* Top Bar */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #e3e1d8',
        display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap'
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
          Debate Card Splitter <span style={{ color: '#5e5d59', fontWeight: 400 }}>demo</span>
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#5e5d59', marginLeft: 'auto' }}>
          <span><b style={{ color: '#1f1e1d', fontWeight: 600, marginRight: '4px' }}>3</b>documents</span>
          <span><b style={{ color: '#1f1e1d', fontWeight: 600, marginRight: '4px' }}>{cards.length}</b>cards</span>
          <span><b style={{ color: '#1f1e1d', fontWeight: 600, marginRight: '4px' }}>{filtered.length}</b>shown</span>
        </div>
      </div>

      {/* Search Row */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid #e3e1d8',
        display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap'
      }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <input 
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Try: "climate change", nuclear AND weapons, energy -fossil, climat~'
            style={{
              width: '100%', padding: '9px 40px 9px 12px',
              border: '1px solid #c9c7be', borderRadius: '6px',
              fontSize: '14px', background: '#ffffff', outline: 'none'
            }}
          />
          <button 
            onClick={() => setShowSearchHelp(!showSearchHelp)}
            style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              width: '20px', height: '20px', borderRadius: '50%',
              background: '#f6f5f1', color: '#8a8983', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 'bold'
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
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600 }}>Enhanced Search</h4>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                <li>"climate change" - Exact phrase</li>
                <li>nuclear AND weapons - Both required</li>
                <li>energy OR renewable - Either word</li>
                <li>climate -denial - Exclude denial</li>
                <li>climat~ - Fuzzy match</li>
              </ul>
            </div>
          )}
        </div>
        
        <div style={{
          display: 'flex', gap: '4px', background: '#f6f5f1',
          padding: '3px', borderRadius: '6px'
        }}>
          {['all', 'tag', 'cite', 'body'].map(scope => (
            <button
              key={scope}
              onClick={() => setSearchScope(scope)}
              style={{
                border: 'none', background: searchScope === scope ? '#ffffff' : 'transparent',
                padding: '5px 10px', fontSize: '12px', borderRadius: '4px',
                cursor: 'pointer', color: searchScope === scope ? '#1f1e1d' : '#5e5d59'
              }}
            >
              {scope.charAt(0).toUpperCase() + scope.slice(1)}
            </button>
          ))}
        </div>

        <select 
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          style={{
            fontSize: '13px', padding: '8px 10px', borderRadius: '6px',
            border: '1px solid #c9c7be', background: '#ffffff'
          }}
        >
          <option value="doc">Document order</option>
          <option value="alpha">Author (A–Z)</option>
          <option value="relevance">Relevance</option>
        </select>
      </div>

      {/* Main Content */}
      <div style={{
        display: 'grid', gridTemplateColumns: '400px 1fr',
        minHeight: 0, overflow: 'hidden'
      }}>
        {/* Left Pane - Card List */}
        <div style={{
          borderRight: '1px solid #e3e1d8', overflowY: 'auto',
          background: '#f6f5f1'
        }}>
          <div style={{
            position: 'sticky', top: 0, background: '#f6f5f1',
            padding: '10px 14px', borderBottom: '1px solid #e3e1d8',
            fontSize: '12px', color: '#5e5d59'
          }}>
            {filtered.length} of {cards.length} cards
          </div>
          
          {filtered.map(card => (
            <div 
              key={card.id}
              onClick={() => setSelectedCard(card)}
              style={{
                padding: '12px 14px', borderBottom: '1px solid #e3e1d8',
                cursor: 'pointer', background: selectedCard?.id === card.id ? '#ffffff' : '#f6f5f1',
                borderLeft: selectedCard?.id === card.id ? '3px solid #6f8bd6' : 'none'
              }}
            >
              <div style={{ fontSize: '10px', color: '#8a8983', marginBottom: '4px' }}>
                {card.docName} • {card.section}
                {card.searchScore && sortOrder === 'relevance' && (
                  <span style={{ marginLeft: '8px', color: '#8a8983' }}>
                    {Math.round(card.searchScore)}
                  </span>
                )}
              </div>
              <div 
                style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}
                dangerouslySetInnerHTML={{ __html: highlightMatches(card.tag, search) }}
              />
              <div 
                style={{ fontSize: '11px', color: '#5e5d59', marginBottom: '6px' }}
                dangerouslySetInnerHTML={{ __html: highlightMatches(card.cite, search) }}
              />
              <div 
                style={{ fontSize: '11px', color: '#5e5d59', fontFamily: 'Georgia, serif' }}
                dangerouslySetInnerHTML={{ __html: highlightMatches(card.bodyPlain.substring(0, 150) + '...', search) }}
              />
            </div>
          ))}
        </div>

        {/* Right Pane - Card Preview */}
        <div style={{ padding: '20px', overflowY: 'auto' }}>
          {selectedCard ? (
            <div>
              {selectedCard.section && (
                <div style={{ fontSize: '10px', color: '#8a8983', marginBottom: '8px', textTransform: 'uppercase' }}>
                  {selectedCard.section}
                </div>
              )}
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px' }}>
                {selectedCard.tag}
              </h2>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '16px' }}>
                {selectedCard.cite}
              </div>
              <div style={{ fontSize: '14px', lineHeight: '1.6', fontFamily: 'Georgia, serif' }}>
                {selectedCard.bodyPlain}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', color: '#8a8983'
            }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>←</div>
              Select a card from the list to view it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DebateCardSplitter;