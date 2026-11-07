(() => {
  'use strict';

  if (!projectData.length) return;

  const settings = {
    reveal: { start: 0.75, finish: 0.5 },
    scroll: { speed: 0.5, inertia: 0.88 },
    typing: { msPerLetter: 32, jitter: 0.45, maxLag: 180, caretPause: 300 },
    names: { center: 0.56, msPerLetter: 55 },
    percentageZeroLevel: 2,
    artFrom: 0.1,
    grain: { start: 0.3, end: 1, curve: 1.5, interval: 55, coarseLevel: 5, coarseStrength: 14 },
    figureNoise: { from: 0.15, to: 0.5, curve: 1.6 },
    figure: { overlap: 0.15, margin: 20, spread: 40, hideDelay: 400 },
    parallax: { strength: 3.5, ease: 0.08 },
    layout: {
      landscape: {
        frame: { width: 1440, height: 1024 },
        figure: { width: 688, height: 450, left: 290 },
        spots: [[960, 790], [720, 810], [1060, 290], [760, 260], [1150, 560], [540, 820], [1180, 820], [900, 220]],
        ruler: { top: 195, step: 268, bottom: 104 },
      },
      portrait: {
        frame: { width: 390, height: 844 },
        figure: { width: 350, height: 270, left: 32 },
        spots: [[195, 190], [195, 650], [180, 140], [210, 700]],
        ruler: { top: 104, step: 200, bottom: 60 },
      },
    },
  };

  const FRAME = 1000 / 60;
  const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'in']);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const random = (min, max) => min + Math.random() * (max - min);
  const round3 = (value) => Math.round(value * 1000) / 1000;

  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  const coverage = (rect, others) => others.reduce((sum, other) => sum + overlap(rect, other), 0);

  const boxOf = (el, pad = 0) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad };
  };

  const fitInto = (area, x, y, w, h) => ({
    x: clamp(x, area.x0, Math.max(area.x0, area.x1 - w)),
    y: clamp(y, area.y0, Math.max(area.y0, area.y1 - h)),
    w,
    h,
  });

  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  const splitGraphemes = (text) => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text));

  const titleCase = (label) => String(label || '')
    .replace(/^\s*\d+\s*[.)\-–]?\s*/, '')
    .toLowerCase()
    .replace(/\b([a-zà-ÿ])([a-zà-ÿ]*)/g, (word, first, rest) => (SMALL_WORDS.has(word) ? word : first.toUpperCase() + rest))
    .replace(/^./, (c) => c.toUpperCase());

  const cleanLink = (link) => {
    if (!link) return null;
    const text = String(link);
    const markdown = text.match(/\((https?:\/\/[^)\s]+)\)/);
    return (markdown ? markdown[1] : text.replace(/^\[|\]$/g, '')).trim() || null;
  };

  const quoted = (text) => (/^[“"]/.test(text) ? text : `“${text}”`);
  const linkLabel = (url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const normalise = (text) => text.toLowerCase().replace(/[‘’]/g, "'");

  const create = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const portrait = window.matchMedia('(orientation: portrait)');
  const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)');
  const layout = () => settings.layout[portrait.matches ? 'portrait' : 'landscape'];

  const byId = (id) => document.getElementById(id);
  const root = document.documentElement;
  const viewportEl = byId('viewport');
  const backdropEl = byId('backdrop');
  const artImage = byId('art');
  const artFrame = artImage.parentElement;
  const grainEl = byId('grain');
  const coarseGrainEl = byId('grain-coarse');
  const pageEl = byId('page');
  const railEl = byId('rail');
  const rulerEl = byId('ruler');
  const quotesEl = byId('quotes');
  const titleEl = byId('title');
  const percentageEl = byId('percentage');
  const aboutEl = byId('about');
  const aboutButton = byId('about-button');
  const panelImage = byId('panel-image');
  const figureEl = byId('figure');
  const figureCaption = figureEl.querySelector('figcaption');
  const figureImage = byId('figure-image');
  const figureNoiseEl = byId('figure-noise');
  const figureNumber = byId('figure-number');
  const figureName = byId('figure-name');
  const figureDescription = byId('figure-description');
  const figureLink = byId('figure-link');

  const layers = [...document.querySelectorAll('[data-depth]')].map((el) => ({ el, depth: Number(el.dataset.depth) }));
  const quotesDepth = Number(quotesEl.dataset.depth);
  const figureDepth = Number(figureEl.dataset.depth);

  const palette = getComputedStyle(root);
  const gradientStart = parseFloat(palette.getPropertyValue('--gradient-start')) / 100;
  const deepRed = parseInt(palette.getPropertyValue('--deep-red').trim().slice(1, 3), 16) / 255;

  const levels = groupByLevel(projectData);
  const quoteCount = levels.reduce((sum, level) => sum + level.quotes.length, 0);
  const levelStart = (number) => levels
    .slice(0, clamp(number, 1, levels.length) - 1)
    .reduce((sum, level) => sum + level.quotes.length, 0) / quoteCount;

  const coarseStart = levelStart(settings.grain.coarseLevel);
  const zeroAt = clamp(levelStart(settings.percentageZeroLevel), 0.001, 0.999);
  const noiseByLevel = levels.map((_, i) => {
    const { from, to, curve } = settings.figureNoise;
    const t = levels.length > 1 ? i / (levels.length - 1) : 1;
    return (from + (to - from) * t ** curve).toFixed(2);
  });

  const quotes = [];
  const sections = [];
  const figures = [];
  const ticks = [];

  const view = { width: 0, height: 0, u: 1, speed: 1, inertia: 0, maxOffset: 0, pageHeight: 0 };
  const scroll = { offset: 0 };
  const parallax = { x: 0, y: 0, aimX: 0, aimY: 0, shiftX: 0, shiftY: 0 };
  const pointer = { x: -1, y: -1, type: 'mouse' };
  const popup = { current: null, hideTimer: 0, hiding: false, lastSpot: -1 };
  const loop = { running: false, last: 0, letterDebt: 0, grainMoved: 0 };
  const drawn = { percentage: '', fine: -1, coarse: '' };
  let activeIndex = -1;
  let aboutOpen = false;
  let artTravel = 0;

  function groupByLevel(entries) {
    const grouped = new Map();
    for (const entry of entries) {
      if (!grouped.has(entry.level)) grouped.set(entry.level, { name: titleCase(entry.level), quotes: [] });
      grouped.get(entry.level).quotes.push({
        text: quoted(entry.quote),
        author: entry.citation,
        keyword: entry.keyword,
        figure: {
          label: String(entry.figureId || '').trim(),
          name: entry.figureName || '',
          description: entry.academicCitation || '',
          link: cleanLink(entry.link),
          src: entry.image || '',
        },
      });
    }
    return [...grouped.values()];
  }

  function letters(parent, text) {
    return splitGraphemes(text).map((letter) => {
      const span = create('span', 'c', parent);
      span.textContent = letter;
      return span;
    });
  }

  function keywordIn(parent, mark) {
    const node = create('b', 'keyword', parent);
    node.dataset.figure = mark.figure;
    figures[mark.figure].keywords.push(node);
    return node;
  }

  function typeset(container, text, quote, mark) {
    const add = (parent, part) => quote.letters.push(...letters(parent, part));
    let pos = 0;

    text.split('\n').forEach((line, row) => {
      if (row > 0) {
        create('br', '', container);
        pos += 1;
      }

      line.split(' ').forEach((word, column) => {
        if (column > 0) {
          const insideMark = mark && pos > mark.start && pos < mark.end;
          add(insideMark ? keywordIn(container, mark) : container, ' ');
          const previous = quote.words[quote.words.length - 1];
          if (previous) previous.endWithSpace = quote.letters.length;
          pos += 1;
        }
        if (!word) return;

        const wordEl = create('span', 'word', container);
        const start = pos;
        pos += word.length;

        if (mark && start < mark.end && pos > mark.start) {
          const from = Math.max(0, mark.start - start);
          const to = Math.min(word.length, mark.end - start);
          add(wordEl, word.slice(0, from));
          add(keywordIn(wordEl, mark), word.slice(from, to));
          add(wordEl, word.slice(to));
        } else {
          add(wordEl, word);
        }

        quote.words.push({ el: wordEl, end: quote.letters.length, endWithSpace: quote.letters.length, shown: false });
      });
    });
  }

  function preload(figure) {
    return new Promise((resolve) => {
      if (!figure.src) {
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        figure.w = img.naturalWidth;
        figure.h = img.naturalHeight;
        resolve();
      };
      img.onerror = () => {
        console.warn(`Image not found: ${figure.src}`);
        resolve();
      };
      img.src = figure.src;
    });
  }

  function createFigure(data) {
    const start = normalise(data.text).indexOf(normalise(data.keyword));
    if (start < 0) {
      console.warn(`Keyword not found in quote: "${data.keyword}"`);
      return null;
    }
    const figure = { ...data.figure, index: figures.length, keywords: [] };
    figure.label ||= `[${figures.length + 1}]`;
    figure.ready = preload(figure);
    figures.push(figure);
    return { start, end: start + data.keyword.length, figure: figure.index };
  }

  function createQuote(data, section, level) {
    const mark = data.keyword ? createFigure(data) : null;
    const el = create('figure', 'quote', section);
    const spoken = create('p', 'sr-only', el);
    spoken.textContent = `${data.text.replace(/\s*\n\s*/g, ' ')} ${data.author || ''}`.trim();

    const quote = { el, level, words: [], letters: [], typed: 0, target: 0, caretAt: -1, authorEl: null };
    quote.caret = create('span', 'bar cursor', el);
    quote.textEl = create('blockquote', 'quote-text', el);
    quote.textEl.setAttribute('aria-hidden', 'true');
    typeset(quote.textEl, data.text, quote, mark);
    quote.textEnd = quote.letters.length;

    if (data.author) {
      quote.authorEl = create('figcaption', 'quote-author', el);
      quote.authorEl.setAttribute('aria-hidden', 'true');
      typeset(quote.authorEl, data.author, quote);
    }

    if (mark) figures[mark.figure].quote = quote;
    return quote;
  }

  function createLevel(level, index) {
    const number = index + 1;
    const section = create('section', '', quotesEl);
    section.dataset.level = number;
    section.setAttribute('aria-labelledby', `level-${number}`);

    const heading = create('h2', 'sr-only', section);
    heading.id = `level-${number}`;
    heading.textContent = level.name;

    const nameEl = create('p', 'level-name', railEl);
    nameEl.dataset.level = number;

    const first = quotes.length;
    level.quotes.forEach((data) => quotes.push(createQuote(data, section, index)));
    sections.push({ nameEl, letters: letters(nameEl, level.name), first, last: quotes.length - 1, shown: 0, startedAt: null, y: NaN });
  }

  function grainTexture(shade) {
    const side = 256;
    const canvas = create('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    const image = context.createImageData(side, side);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = image.data[i + 1] = image.data[i + 2] = shade();
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return `url(${canvas.toDataURL()})`;
  }

  function paintGrain() {
    const fine = grainTexture(() => (Math.random() + Math.random()) * 127.5);
    grainEl.style.backgroundImage = fine;
    figureNoiseEl.style.backgroundImage = fine;
    coarseGrainEl.style.backgroundImage = grainTexture(() => Math.random() * 255);
  }

  const contentBottom = (q) => {
    const last = q.authorEl || q.textEl;
    return last.offsetTop + last.offsetHeight;
  };

  function measure() {
    view.width = window.innerWidth;
    view.height = window.innerHeight;
    view.u = parseFloat(getComputedStyle(root).getPropertyValue('--u')) || 1;
    const still = reducedMotion || touchOnly.matches;
    view.speed = still ? 1 : settings.scroll.speed;
    view.inertia = still ? 0 : settings.scroll.inertia;

    measureQuotes();

    const last = quotes[quotes.length - 1];
    const parallaxRoom = reducedMotion || portrait.matches ? 0 : quotesDepth * settings.parallax.strength * view.u;
    view.maxOffset = Math.ceil(last.end + parallaxRoom);
    view.pageHeight = view.maxOffset + view.height;
    pageEl.style.height = `${view.pageHeight}px`;
    backdropEl.style.height = `${view.pageHeight}px`;
    document.body.style.height = `${Math.ceil(view.maxOffset / view.speed) + view.height}px`;

    measureSections();
    buildRuler();
    measureArt();
    quotes.forEach((q) => {
      q.caretAt = -1;
      updateCaret(q);
    });
  }

  function measureQuotes() {
    const begin = Math.round(settings.reveal.start * view.height);
    const finish = settings.reveal.finish * view.height;
    quotesEl.style.paddingTop = `${begin}px`;

    let previous = 0;
    for (const q of quotes) {
      q.top = quotesEl.offsetTop + q.el.offsetTop;
      q.height = q.el.offsetHeight;
      q.end = Math.max(previous + 1, q.top + contentBottom(q) / 2 - finish);
      q.start = clamp(q.top - begin, previous, q.end - 1);
      previous = q.end;
    }
  }

  function measureSections() {
    const rulerTop = layout().ruler.top * view.u;
    sections.forEach((s, i) => {
      const first = quotes[s.first];
      const last = quotes[s.last];
      s.top = i === 0 ? Math.min(first.top, rulerTop) : first.top;
      s.bottom = last.top + last.height;
      s.length = s.nameEl.offsetHeight;
      s.y = NaN;
    });
  }

  function buildRuler() {
    const { top, step, bottom } = layout().ruler;
    const { u, pageHeight } = view;
    const last = quotes[quotes.length - 1];
    const start = top * u;
    const end = Math.min(pageHeight - 12 * u, Math.max(pageHeight - bottom * u, last.top + contentBottom(last) + 30 * u));
    const count = Math.max(1, Math.round((end - start) / (step * u)));

    rulerEl.style.top = `${start}px`;
    rulerEl.style.height = `${(end - start).toFixed(2)}px`;
    if (ticks.length === count + 1) return;

    ticks.splice(0).forEach((tick) => tick.remove());
    for (let k = 0; k <= count; k += 1) {
      const tick = create('span', 'bar tick', rulerEl);
      tick.style.top = `${(100 * k) / count}%`;
      ticks.push(tick);
    }
  }

  function measureArt() {
    artTravel = Math.max(0, artImage.offsetHeight - artFrame.offsetHeight);
  }

  function renderArt() {
    const from = settings.artFrom * artTravel;
    const t = view.maxOffset > 0 ? clamp(scroll.offset / view.maxOffset, 0, 1) : 0;
    artImage.style.transform = `translate3d(0, ${(-(from + (artTravel - from) * t)).toFixed(1)}px, 0)`;
  }

  function placeCaret(q, count) {
    const after = count > 0;
    const letter = q.letters[after ? count - 1 : 0];
    const rects = letter.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : letter.getBoundingClientRect();
    const box = q.el.getBoundingClientRect();
    const size = rect.height;
    const height = size * 0.84;
    const gap = after ? size * (count === q.textEnd ? 0.24 : 0.05) : 0;
    const x = (after ? rect.right + gap : rect.left) - box.left;
    const y = rect.top - box.top + (size - height) / 2 + size * 0.03;

    q.caret.style.width = `${Math.max(2.5, size * 0.11).toFixed(2)}px`;
    q.caret.style.height = `${height.toFixed(2)}px`;
    q.caret.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  }

  function updateCaret(q) {
    const count = Math.min(q.typed, q.textEnd);
    if (count === q.caretAt) return;
    placeCaret(q, count);
    q.caretAt = count;
  }

  function pauseBlink(q) {
    if (!q) return;
    q.caret.classList.add('typing');
    clearTimeout(q.blinkTimer);
    q.blinkTimer = setTimeout(() => q.caret.classList.remove('typing'), settings.typing.caretPause);
  }

  function showLetters(q, count) {
    if (count === q.typed) return;
    const from = Math.min(count, q.typed);
    const to = Math.max(count, q.typed);
    for (let i = from; i < to; i += 1) q.letters[i].classList.toggle('on', i < count);
    q.typed = count;

    for (const word of q.words) {
      const shown = count >= word.end;
      if (shown === word.shown) continue;
      word.shown = shown;
      word.el.classList.toggle('visible', shown);
    }

    q.el.classList.toggle('started', count > 0);
    pauseBlink(q);
    updateCaret(q);
  }

  function raiseTarget(q, progress) {
    const words = Math.min(q.words.length, Math.floor(progress * q.words.length + 1e-6));
    const target = words > 0 ? q.words[words - 1].endWithSpace : 0;
    if (target <= q.target) return;
    q.target = target;
    if (reducedMotion) showLetters(q, target);
    else wake();
  }

  function typeLetters(dt) {
    let remaining = 0;
    for (const q of quotes) remaining += Math.max(0, q.target - q.typed);
    if (!remaining) {
      loop.letterDebt = 0;
      return false;
    }

    const { msPerLetter, jitter, maxLag } = settings.typing;
    const rhythm = (1000 / msPerLetter) * (1 + random(-1, 1) * jitter);
    const catchUp = remaining / (maxLag / 1000);
    loop.letterDebt += (dt / 1000) * Math.max(rhythm, catchUp);

    let budget = Math.floor(loop.letterDebt);
    loop.letterDebt -= budget;
    for (const q of quotes) {
      if (budget <= 0) break;
      const step = Math.min(budget, q.target - q.typed);
      if (step <= 0) continue;
      showLetters(q, q.typed + step);
      budget -= step;
    }
    return true;
  }

  function revealQuotes(read) {
    let reached = 0;
    let active = 0;
    quotes.forEach((q, i) => {
      const progress = clamp((read - q.start) / (q.end - q.start), 0, 1);
      reached += progress;
      if (read >= q.start) active = i;
      raiseTarget(q, progress);
      if (q.typed < q.target && (progress >= 1 || q.top + q.height < read)) showLetters(q, q.target);
    });
    setActive(active);
    return reached / quotes.length;
  }

  function setActive(index) {
    if (index === activeIndex) return;
    quotes[activeIndex]?.el.classList.remove('active');
    activeIndex = index;
    quotes[index].el.classList.add('active');
    percentageEl.dataset.level = quotes[index].level + 1;
  }

  function renderNames() {
    const y = scroll.offset;
    const center = settings.names.center * view.height;
    for (const s of sections) {
      const lowest = s.bottom - s.length;
      const top = lowest >= s.top ? clamp(y + center - s.length / 2, s.top, lowest) : (s.top + lowest) / 2;
      if (Number.isNaN(s.y) || Math.abs(top - s.y) > 0.2) {
        s.y = top;
        s.nameEl.style.translate = `0 ${top.toFixed(1)}px`;
      }
      const inView = top < y + view.height - s.length * 0.25 && top + s.length > y + view.height * 0.1;
      if (s.startedAt === null && inView) startName(s);
    }
  }

  function startName(s) {
    s.startedAt = performance.now();
    if (reducedMotion) revealName(s, s.letters.length);
    else wake();
  }

  function revealName(s, count) {
    const target = Math.min(count, s.letters.length);
    for (; s.shown < target; s.shown += 1) s.letters[s.shown].classList.add('on');
  }

  function typeNames(time) {
    let busy = false;
    for (const s of sections) {
      if (s.startedAt === null || s.shown === s.letters.length) continue;
      revealName(s, Math.floor(Math.max(0, time - s.startedAt) / settings.names.msPerLetter) + 1);
      busy ||= s.shown < s.letters.length;
    }
    return busy;
  }

  function renderPercentage(progress) {
    const value = progress <= zeroAt
      ? 100 * (1 - progress / zeroAt)
      : -100 * ((progress - zeroAt) / (1 - zeroAt));
    const text = String(Math.round(value) || 0);
    if (text === drawn.percentage) return;
    drawn.percentage = text;
    percentageEl.textContent = text;
  }

  function coarseAlpha(position) {
    const red = position <= gradientStart ? 0 : clamp((position - gradientStart) / (1 - gradientStart), 0, 1) * deepRed;
    const contrast = Math.max(0.15, red < 0.5 ? 2 * red : 2 * (1 - red));
    return clamp(settings.grain.coarseStrength / (contrast * 0.25 * 255), 0, 1);
  }

  function renderGrain(progress) {
    const { start, end, curve } = settings.grain;
    const step = 1 / quotes.length;
    const mix = clamp((progress - coarseStart + step * 0.5) / (step * 1.5), 0, 1);

    const fine = round3(clamp(start + (end - start) * clamp(progress, 0, 1) ** curve, 0, 1) * (1 - 0.85 * mix));
    if (fine !== drawn.fine) {
      drawn.fine = fine;
      grainEl.style.setProperty('--amount', fine);
    }

    const y = scroll.offset;
    const top = round3(mix * coarseAlpha(y / view.pageHeight));
    const bottom = round3(mix * coarseAlpha((y + view.height) / view.pageHeight));
    const coarse = `${top}/${bottom}`;
    if (coarse !== drawn.coarse) {
      drawn.coarse = coarse;
      coarseGrainEl.style.setProperty('--top', top);
      coarseGrainEl.style.setProperty('--bottom', bottom);
    }
  }

  function shuffleGrain(el) {
    el.style.backgroundPosition = `${random(0, 256).toFixed(1)}px ${random(0, 256).toFixed(1)}px`;
  }

  function moveGrain(time) {
    if (time - loop.grainMoved < settings.grain.interval) return;
    loop.grainMoved = time;
    if (drawn.fine > 0) shuffleGrain(grainEl);
    if (popup.current) shuffleGrain(figureNoiseEl);
    if (drawn.coarse !== '0/0') shuffleGrain(coarseGrainEl);
  }

  function render() {
    const y = scroll.offset;
    const dpr = window.devicePixelRatio || 1;
    const sheet = `translate3d(0, ${-Math.round(y * dpr) / dpr}px, 0)`;
    pageEl.style.transform = sheet;
    backdropEl.style.transform = sheet;
    renderArt();

    const progress = revealQuotes(y - parallax.shiftY * quotesDepth);
    renderNames();
    renderPercentage(progress);
    renderGrain(progress);
    if (popup.current) checkPointer();
  }

  const scrollTarget = () => clamp(window.scrollY * view.speed, 0, view.maxOffset);

  function followScroll(dt) {
    const target = scrollTarget();
    if (scroll.offset === target) return false;
    if (view.inertia > 0) {
      scroll.offset += (target - scroll.offset) * (1 - view.inertia ** (dt / FRAME));
      if (Math.abs(target - scroll.offset) < 0.3) scroll.offset = target;
    } else {
      scroll.offset = target;
    }
    return true;
  }

  function aimParallax(x, y) {
    parallax.aimX = x;
    parallax.aimY = y;
    wake();
  }

  function followParallax(dt) {
    if (parallax.x === parallax.aimX && parallax.y === parallax.aimY) return false;
    const t = 1 - (1 - settings.parallax.ease) ** (dt / FRAME);
    parallax.x += (parallax.aimX - parallax.x) * t;
    parallax.y += (parallax.aimY - parallax.y) * t;
    if (Math.abs(parallax.aimX - parallax.x) < 0.0005 && Math.abs(parallax.aimY - parallax.y) < 0.0005) {
      parallax.x = parallax.aimX;
      parallax.y = parallax.aimY;
    }
    applyParallax();
    return true;
  }

  function applyParallax() {
    const k = portrait.matches ? 0 : view.u * settings.parallax.strength;
    parallax.shiftX = -parallax.x * k;
    parallax.shiftY = -parallax.y * k;
    for (const { el, depth } of layers) {
      el.style.translate = `${(parallax.shiftX * depth).toFixed(2)}px ${(parallax.shiftY * depth).toFixed(2)}px`;
    }
  }

  function wake() {
    if (loop.running) return;
    loop.running = true;
    loop.last = 0;
    requestAnimationFrame(animate);
  }

  function animate(time) {
    const dt = loop.last ? Math.min(100, time - loop.last) : FRAME;
    loop.last = time;

    const scrolled = followScroll(dt);
    const shifted = followParallax(dt);
    if (scrolled || shifted) render();

    const typing = typeLetters(dt);
    const naming = typeNames(time);
    const grainy = !reducedMotion && !aboutOpen;
    if (grainy) moveGrain(time);

    if (scrolled || shifted || typing || naming || grainy) requestAnimationFrame(animate);
    else loop.running = false;
  }

  function figureSize(figure) {
    const { width, height } = layout().figure;
    const w = figure.w || 16;
    const h = figure.h || 9;
    const scale = Math.min(width / w, height / h, 1);
    return { w: w * scale * view.u, h: h * scale * view.u };
  }

  function captionHeight(width) {
    figureEl.style.width = `${width}px`;
    figureEl.style.height = '1px';
    return figureCaption.offsetHeight;
  }

  function freeArea() {
    const frame = pageEl.getBoundingClientRect();
    const edge = 32 * view.u;
    return {
      x0: Math.max(edge, frame.left + layout().figure.left * view.u),
      x1: Math.min(view.width, frame.right) - edge,
      y0: edge,
      y1: view.height - edge,
    };
  }

  function lineBoxes(q, pad, withCaret = true) {
    const lines = [];
    for (const block of [q.textEl, q.authorEl]) {
      if (!block) continue;
      const range = document.createRange();
      range.selectNodeContents(block);
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        const line = lines.find((l) => l.block === block && Math.abs(l.top - r.top) < r.height / 2);
        if (line) {
          line.left = Math.min(line.left, r.left);
          line.right = Math.max(line.right, r.right);
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
        } else {
          lines.push({ block, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
      }
    }

    const boxes = lines.map((l) => ({ x: l.left - pad, y: l.top - pad, w: l.right - l.left + 2 * pad, h: l.bottom - l.top + 2 * pad }));
    if (withCaret && q.el.classList.contains('started')) boxes.push(boxOf(q.caret, pad));
    return boxes;
  }

  function placementPlan(figure) {
    const q = figure.quote;
    const mode = layout();
    const { u, height } = view;
    const base = figureSize(figure);
    const area = freeArea();
    const frame = pageEl.getBoundingClientRect();
    const margin = settings.figure.margin * u;

    const padded = lineBoxes(q, margin);
    const keys = [...q.el.querySelectorAll('.keyword')].flatMap((k) => [...k.getClientRects()]);
    const keyLines = padded.filter((z) => keys.some((k) => k.bottom > z.y + margin && k.top < z.y + z.h - margin));
    const center = keys.length
      ? { x: (keys[0].left + keys[keys.length - 1].right) / 2, y: (keys[0].top + keys[keys.length - 1].bottom) / 2 }
      : { x: view.width / 2, y: height / 2 };

    const sizes = [1, 0.85, 0.7, 0.55].map((scale) => {
      const w = Math.min(base.w * scale, area.x1 - area.x0);
      const fitted = w / base.w;
      return { scale: fitted, w, h: Math.max(base.h * fitted, captionHeight(w)) };
    });

    return {
      base,
      area,
      center,
      sizes,
      padded,
      full: sizes[0].w * sizes[0].h,
      lines: lineBoxes(q, 4 * u),
      allowed: lineBoxes(q, 0, false).reduce((sum, z) => sum + z.w * z.h, 0) * settings.figure.overlap,
      hard: [titleEl, aboutButton, percentageEl].map((el) => boxOf(el, 10 * u)).concat(keyLines),
      others: quotes.filter((o) => o !== q && o.typed > 0).map((o) => boxOf(o.el)),
      spots: mode.spots,
      left: frame.left,
      across: frame.width / mode.frame.width,
      down: height / mode.frame.height,
    };
  }

  function bestNear(plan, [sx, sy], size) {
    const { spread } = settings.figure;
    const { u } = view;
    let best = null;

    for (let attempt = 0; attempt < 5 && !(best && best.cover === 0); attempt += 1) {
      const cx = plan.left + sx * plan.across + random(-1, 1) * spread * u;
      const cy = (sy + random(-1, 1) * spread) * plan.down;
      const distance = Math.hypot(cx - plan.center.x, cy - plan.center.y) || 1;
      const dx = (cx - plan.center.x) / distance;
      const dy = (cy - plan.center.y) / distance;

      for (let k = 0; k <= 40; k += 1) {
        const rect = fitInto(plan.area, cx - size.w / 2 + dx * k * 10 * u, cy - size.h / 2 + dy * k * 10 * u, size.w, size.h);
        if (plan.hard.some((o) => overlap(rect, o) > 0)) continue;
        const cover = coverage(rect, plan.lines);
        if (cover > plan.allowed) continue;
        if (!best || cover < best.cover) best = { rect, cover };
        if (cover === 0) break;
      }
    }
    return best;
  }

  function enlarge(plan, rect) {
    const { area, base, hard, lines, allowed } = plan;
    const fits = (r) => r.x >= area.x0 - 0.5 && r.x + r.w <= area.x1 + 0.5 && r.y >= area.y0 - 0.5 && r.y + r.h <= area.y1 + 0.5
      && !hard.some((o) => overlap(r, o) > 0) && coverage(r, lines) <= allowed * 0.8;

    let best = rect;
    for (let step = 0; step < 16; step += 1) {
      const w = Math.min(best.w * 1.04, base.w, area.x1 - area.x0);
      if (w <= best.w + 0.5) break;
      const h = Math.max(base.h * (w / base.w), captionHeight(w));
      const anchors = [
        [best.x + (best.w - w) / 2, best.y + (best.h - h) / 2],
        [best.x, best.y],
        [best.x + best.w - w, best.y],
        [best.x, best.y + best.h - h],
        [best.x + best.w - w, best.y + best.h - h],
      ];
      const next = anchors.map(([x, y]) => ({ x, y, w, h })).find(fits);
      if (!next) break;
      best = next;
    }
    return best;
  }

  function fallbackSpot(plan) {
    const smallest = plan.sizes[plan.sizes.length - 1];
    return plan.spots
      .map(([sx, sy], i) => {
        const rect = fitInto(plan.area, plan.left + sx * plan.across - smallest.w / 2, sy * plan.down - smallest.h / 2, smallest.w, smallest.h);
        return { i, rect, cost: coverage(rect, plan.padded) };
      })
      .reduce((a, b) => (b.cost < a.cost ? b : a));
  }

  function chooseSpot(figure) {
    const plan = placementPlan(figure);
    const candidates = [];

    plan.spots.forEach((spot, i) => {
      for (const size of plan.sizes) {
        const best = bestNear(plan, spot, size);
        if (!best) continue;
        const cost = best.cover * 0.2 + coverage(best.rect, plan.others) * 0.15 + (1 - size.scale) ** 2 * plan.full * 2.5;
        candidates.push({ i, rect: best.rect, cost });
      }
    });
    if (!candidates.length) return fallbackSpot(plan);

    const fresh = candidates.filter((c) => c.i !== popup.lastSpot);
    const pool = fresh.length ? fresh : candidates;
    const cheapest = Math.min(...pool.map((c) => c.cost));
    const good = pool.filter((c) => c.cost <= cheapest + plan.full * 0.04);
    const pick = good[Math.floor(Math.random() * good.length)];
    return { i: pick.i, rect: enlarge(plan, pick.rect) };
  }

  function placeFigure(figure) {
    const { i, rect } = chooseSpot(figure);
    const frame = pageEl.getBoundingClientRect();
    popup.lastSpot = i;
    figureEl.style.width = `${rect.w.toFixed(1)}px`;
    figureEl.style.height = `${rect.h.toFixed(1)}px`;
    figureEl.style.left = `${(rect.x - frame.left - parallax.shiftX * figureDepth).toFixed(1)}px`;
    figureEl.style.top = `${(rect.y - frame.top - parallax.shiftY * figureDepth).toFixed(1)}px`;
    figure.placedWith = figure.w || 0;
  }

  function fillFigure(figure) {
    figureImage.hidden = !figure.src;
    if (figure.src) figureImage.src = figure.src;
    figureNoiseEl.style.opacity = noiseByLevel[figure.quote.level];
    figureNumber.textContent = figure.label;
    figureName.textContent = figure.name;
    figureDescription.textContent = figure.description;
    figureLink.hidden = !figure.link;
    if (figure.link) {
      figureLink.href = figure.link;
      figureLink.textContent = `${linkLabel(figure.link)} ↗`;
    } else {
      figureLink.removeAttribute('href');
      figureLink.textContent = '';
    }
  }

  function highlight(figure, on) {
    figure?.keywords.forEach((k) => k.classList.toggle('hover', on));
  }

  function cancelHide() {
    clearTimeout(popup.hideTimer);
    popup.hiding = false;
  }

  const figureVisible = () => figureEl.classList.contains('visible');

  function showFigure(index) {
    const figure = figures[index];
    if (!figure || aboutOpen) return;
    cancelHide();

    const fresh = popup.current !== figure || !figureVisible();
    if (popup.current !== figure) {
      highlight(popup.current, false);
      popup.current = figure;
      fillFigure(figure);
    }
    if (fresh) {
      placeFigure(figure);
      figure.ready.then(() => {
        if (popup.current === figure && figure.placedWith !== (figure.w || 0) && figureVisible()) placeFigure(figure);
      });
    }

    highlight(figure, true);
    figureEl.classList.add('visible');
  }

  function hideFigure(immediate = false) {
    if (!immediate && popup.hiding) return;
    clearTimeout(popup.hideTimer);

    const hide = () => {
      popup.hiding = false;
      highlight(popup.current, false);
      figureEl.classList.remove('visible');
      popup.current = null;
    };

    if (immediate) {
      hide();
    } else {
      popup.hiding = true;
      popup.hideTimer = setTimeout(hide, settings.figure.hideDelay);
    }
  }

  const keywordAt = (target) => target?.closest?.('.word.visible .keyword') ?? null;
  const insideFigure = (target) => Boolean(target?.closest?.('#figure'));
  const figureOf = (keyword) => Number(keyword.dataset.figure);
  const isCurrent = (keyword) => Boolean(keyword && popup.current && figureOf(keyword) === popup.current.index);

  function checkPointer() {
    if (pointer.type !== 'mouse' || pointer.x < 0 || !figureVisible()) return;
    const target = document.elementFromPoint(pointer.x, pointer.y);
    if (insideFigure(target) || isCurrent(keywordAt(target))) cancelHide();
    else hideFigure();
  }

  function setAbout(open) {
    if (open === aboutOpen) return;
    aboutOpen = open;
    if (open) hideFigure(true);

    aboutEl.classList.toggle('open', open);
    root.classList.toggle('about-open', open);
    viewportEl.inert = open;
    aboutButton.setAttribute('aria-expanded', String(open));
    aboutButton.setAttribute('aria-label', open ? 'Close about the project' : 'About the project');

    if (open) {
      aboutEl.scrollTop = 0;
      aboutEl.focus({ preventScroll: true });
    } else {
      aboutButton.focus({ preventScroll: true });
      wake();
    }
  }

  function relayout(force = false) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!force && touchOnly.matches && width === view.width && Math.abs(height - view.height) < height * 0.2) return;

    const ratio = view.maxOffset > 0 ? scroll.offset / view.maxOffset : 0;
    hideFigure(true);
    measure();
    scroll.offset = ratio * view.maxOffset;
    window.scrollTo(0, scroll.offset / view.speed);
    applyParallax();
    render();
  }

  function onScroll() {
    wake();
    pauseBlink(quotes[activeIndex]);
  }

  function onPointerMove(event) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.type = event.pointerType;
    if (event.pointerType === 'touch' || reducedMotion) return;
    aimParallax((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
  }

  function onPointerOver(event) {
    if (event.pointerType === 'touch') return;
    const keyword = keywordAt(event.target);
    if (keyword) showFigure(figureOf(keyword));
    else if (insideFigure(event.target)) cancelHide();
    else if (popup.current) hideFigure();
  }

  function onPointerOut(event) {
    if (event.relatedTarget) return;
    pointer.x = -1;
    aimParallax(0, 0);
    if (event.pointerType !== 'touch' && popup.current) hideFigure();
  }

  function onTap(target) {
    const keyword = keywordAt(target);
    if (keyword) {
      const figure = figures[figureOf(keyword)];
      if (figure === popup.current && figureVisible()) hideFigure(true);
      else showFigure(figure.index);
    } else if (popup.current && !insideFigure(target)) {
      hideFigure(true);
    }
  }

  function onClick({ target }) {
    if (aboutButton.contains(target)) {
      setAbout(!aboutOpen);
    } else if (aboutOpen) {
      if (aboutEl.contains(target) && !target.closest('.panel, .credits')) setAbout(false);
    } else if (pointer.type !== 'mouse') {
      onTap(target);
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (aboutOpen) setAbout(false);
    else if (popup.current) hideFigure(true);
  }

  levels.forEach(createLevel);
  paintGrain();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => relayout());
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', (event) => { pointer.type = event.pointerType; }, { capture: true, passive: true });
  window.addEventListener('blur', () => aimParallax(0, 0));
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);
  document.fonts?.ready.then(() => relayout(true));

  artImage.addEventListener('load', () => {
    measureArt();
    renderArt();
  });
  artImage.src = panelImage.src;

  measure();
  scroll.offset = scrollTarget();
  render();
  wake();
})();
