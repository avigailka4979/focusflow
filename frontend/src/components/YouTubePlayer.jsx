import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

let apiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { apiPromise = null; reject(new Error('YouTube API failed to load')); };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

/** Embedded YouTube player (IFrame API) that exposes the current time and pause/seek. */
const YouTubePlayer = forwardRef(function YouTubePlayer({ videoId, title }, ref) {
  const holder = useRef(null);
  const player = useRef(null);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    getPosition: () => {
      try { return player.current?.getCurrentTime?.() || 0; } catch { return 0; }
    },
    pause: () => { try { player.current?.pauseVideo?.(); } catch { /* not ready */ } },
    play: () => { try { player.current?.playVideo?.(); } catch { /* not ready */ } },
    rewind: (sec) => {
      try {
        const t = player.current?.getCurrentTime?.() || 0;
        player.current?.seekTo?.(Math.max(0, t - sec), true);
        player.current?.playVideo?.();
      } catch { /* not ready */ }
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement('div');
    holder.current?.appendChild(el);
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      });
    }).catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      try { player.current?.destroy?.(); } catch { /* ignore */ }
      player.current = null;
      if (holder.current) holder.current.innerHTML = '';
    };
  }, [videoId]);

  if (failed) {
    // Fallback: a plain embed (no position tracking).
    return (
      <div className="video-frame">
        <iframe title={title} src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>
    );
  }
  return <div className="video-frame" ref={holder} aria-label={`נגן וידאו: ${title}`} />;
});

export default YouTubePlayer;
