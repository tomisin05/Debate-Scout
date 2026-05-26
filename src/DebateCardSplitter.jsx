import { useEffect, useRef } from 'react';

const DebateCardSplitter = () => {
  const iframeRef = useRef(null);

  useEffect(() => {
    // The iframe will load the HTML file from public directory
    if (iframeRef.current) {
      iframeRef.current.src = '/debate_card_splitter.html';
    }
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        style={{
          width: '100%',
          height: '100vh',
          border: 'none',
          display: 'block'
        }}
        title="Debate Card Splitter"
      />
    </div>
  );
};

export default DebateCardSplitter;