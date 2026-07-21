'use strict';

/**
 * ============================================================================
 * Paper Sources Utilities
 * ============================================================================
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESULTS = 10;
const MAX_AUTHORS = 3;
const DEFAULT_RETRIES = 3;
const CACHE_CLEANUP_INTERVAL = 100;

/**
 * Clamp requested result count.
 */
function clampLimit(limit) {
  return Math.max(1, Math.min(Number(limit) || 5, MAX_RESULTS));
}

/**
 * Normalize user query.
 */
function normalizeQuery(query) {
  return String(query || '').trim();
}

/**
 * Sleep helper.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize DOI/OpenAlex URLs.
 */
function normalizeUrl(url) {
  if (!url) return null;

  if (url.startsWith('http://') || url.startsWith('https://'))
    return url;

  if (url.startsWith('10.'))
    return `https://doi.org/${url}`;

  return url;
}

/**
 * Create standardized paper object.
 */
function normalizePaper({
  title,
  year = null,
  authors = [],
  url = null,
  citationCount = 0,
  abstract = null,
}) {
  return {
    title: title || 'Untitled',
    year,
    authors: authors.slice(0, MAX_AUTHORS),
    url: normalizeUrl(url),
    citationCount: Number.isFinite(citationCount)
      ? citationCount
      : 0,
    abstract,
  };
}

/**
 * Retry helper with exponential backoff.
 */
async function retry(fn, retries = DEFAULT_RETRIES) {
  let delay = 500;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries)
        throw err;

      await sleep(delay);
      delay *= 2;
    }
  }
}

/**
 * Remove duplicate papers.
 *
 * Priority:
 * 1. DOI / URL
 * 2. Lowercase title
 */
function deduplicatePapers(papers) {
  const seen = new Set();
  const output = [];

  for (const paper of papers) {
    const key =
      (
        paper.url ||
        paper.title ||
        ''
      )
        .trim()
        .toLowerCase();

    if (!key || seen.has(key))
      continue;

    seen.add(key);
    output.push(paper);
  }

  return output;
}

/**
 * Rank papers by citation count.
 */
function sortByCitation(a, b) {
  return (b.citationCount || 0) - (a.citationCount || 0);
}

/**
 * Build cache key.
 */
function cacheKey(query, limit) {
  return `${query.toLowerCase()}::${limit}`;
}

/**
 * Safe fetch with timeout.
 */
async function fetchJson(fetchImpl, url, headers, timeoutMs) {
  const response = await retry(() =>
    fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  );

  if (!response.ok)
    throw response;

  return response.json();
}

/**
 * Merge papers from multiple providers.
 */
function mergePaperLists(lists, limit) {
  return deduplicatePapers(
    lists
      .flat()
      .sort(sortByCitation)
  ).slice(0, limit);
}

/**
 * ============================================================================
 * Base Paper Source
 * ============================================================================
 */

class BasePaperSource {
  constructor({
    enabled = true,
    fetchImpl = fetch,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    debug = false,
  } = {}) {
    this.enabled = enabled;
    this.fetchImpl = fetchImpl;
    this.cacheTtlMs = cacheTtlMs;
    this.timeoutMs = timeoutMs;
    this.debug = debug;

    this.lastError = null;
    this.cache = new Map();

    this._cleanupCounter = 0;
  }

  /**
   * Provider name.
   * Override in subclasses.
   */
  get provider() {
    return 'base';
  }

  /**
   * Current provider status.
   */
  status() {
    return {
      enabled: this.enabled,
      provider: this.provider,
      error: this.lastError,
    };
  }

  /**
   * Clear error before every request.
   */
  resetError() {
    this.lastError = null;
  }

  /**
   * Cache lookup.
   */
  getCached(query, limit) {
    const key = cacheKey(query, limit);
    const item = this.cache.get(key);

    if (!item)
      return null;

    if (Date.now() - item.at > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * Store cache entry.
   */
  setCached(query, limit, value) {
    const key = cacheKey(query, limit);

    this.cache.set(key, {
      at: Date.now(),
      value,
    });

    this.cleanupCache();
  }

  /**
   * Periodically remove expired cache entries.
   */
  cleanupCache() {
    this._cleanupCounter++;

    if (this._cleanupCounter < CACHE_CLEANUP_INTERVAL)
      return;

    this._cleanupCounter = 0;

    const now = Date.now();

    for (const [key, value] of this.cache.entries()) {
      if (now - value.at > this.cacheTtlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Perform HTTP request.
   */
  async fetch(url, headers = {}) {

  const response = await retry(() =>
    this.fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  );

  if (!response.ok) {

    const body = await response.text().catch(() => '');

    const error = new Error(
      body || `HTTP ${response.status}`
    );

    error.status = response.status;
    error.headers = response.headers;
    error.body = body;

    throw error;
  }

  return response.json();
}

  /**
   * Optional debug logging.
   */
  log(...args) {
    if (this.debug)
      console.log(`[${this.provider}]`, ...args);
  }

  /**
   * Standardized error handling.
   */
  setError(error) {
    if (!error) {
      this.lastError = null;
      return;
    }

    // fetch() Response object
    if (typeof error.status === 'number') {

      if (typeof error.status === 'number') {

  if (error.status === 429) {

    const retryAfter =
      error.headers?.get?.('retry-after');

    this.lastError =
      retryAfter
        ? `Rate limited (HTTP 429). Retry after ${retryAfter} seconds.`
        : 'Rate limited (HTTP 429).';

    return;
  }

  this.lastError =
    error.body
      ? `HTTP ${error.status}: ${error.body}`
      : `HTTP ${error.status}`;

  return;
}

      this.lastError =
        `HTTP ${error.status}`;

      return;
    }

    // Abort
    if (error.name === 'AbortError') {
      this.lastError = 'Request timed out.';
      return;
    }

    // Generic JS Error
    this.lastError =
      error.message || String(error);
  }

  /**
   * Validate user input.
   */
  validate(query, limit) {

    query = normalizeQuery(query)
        .replace(/[*?]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!this.enabled || !query) {
        return {
            ok: false,
            query,
            limit: clampLimit(limit),
        };
    }

    return {
        ok: true,
        query,
        limit: clampLimit(limit),
    };
}

  /**
   * Shared search workflow.
   *
   * Subclasses only implement:
   *
   *   buildUrl(query, limit)
   *   buildHeaders()
   *   mapResults(json)
   */
  async search(query, limit = 5) {

    this.resetError();

    const validation =
      this.validate(query, limit);

    if (!validation.ok)
      return [];

    query = validation.query;
    limit = validation.limit;

    const cached =
      this.getCached(query, limit);

    if (cached) {
      this.log('Cache hit');
      return cached;
    }

    try {

      const url =
        this.buildUrl(query, limit);

      const headers =
        this.buildHeaders
          ? this.buildHeaders()
          : {};

      const payload =
        await this.fetch(url, headers);

      const papers =
        this.mapResults(payload);

      this.setCached(
        query,
        limit,
        papers
      );

      return papers;

    } catch (error) {

      this.setError(error);

      this.log(this.lastError);

      return [];
    }
  }

  /**
   * Abstract methods.
   */
  buildUrl() {
    throw new Error(
      'buildUrl() not implemented'
    );
  }

  mapResults() {
    throw new Error(
      'mapResults() not implemented'
    );
  }

  buildHeaders() {
    return {};
  }
}

/**
 * ============================================================================
 * Semantic Scholar Source
 * ============================================================================
 */

class SemanticScholarSource extends BasePaperSource {

  constructor({
    enabled = true,
    apiKey = '',
    fetchImpl = fetch,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    debug = false,
  } = {}) {

    super({
      enabled,
      fetchImpl,
      cacheTtlMs,
      timeoutMs,
      debug,
    });

    this.apiKey = apiKey;
  }

  get provider() {
    return 'semantic-scholar';
  }

  /**
   * Build Semantic Scholar request URL.
   */
  buildUrl(query, limit) {

    const url = new URL(
      'https://api.semanticscholar.org/graph/v1/paper/search'
    );

    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(limit));

    url.searchParams.set(
      'fields',
      [
        'title',
        'authors',
        'year',
        'abstract',
        'url',
        'citationCount',
      ].join(',')
    );

    return url;
  }

  /**
   * Optional API key.
   */
  buildHeaders() {

    const headers = {};

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Convert Semantic Scholar response
   * into the common paper format.
   */
  mapResults(payload) {

    const papers = payload?.data ?? [];

    return papers
      .filter(paper => paper.title)
      .map(paper =>
        normalizePaper({

          title: paper.title,

          year:
            Number.isFinite(paper.year)
              ? paper.year
              : null,

          authors:
            (paper.authors ?? [])
              .map(author => author.name)
              .filter(Boolean),

          url: paper.url,

          citationCount:
            paper.citationCount,

          abstract:
            paper.abstract ?? null,

        })
      )
      .sort(sortByCitation);
  }

}

/**
 * ============================================================================
 * OpenAlex Source
 * ============================================================================
 */

class OpenAlexSource extends BasePaperSource {

  constructor({
    enabled = true,
    fetchImpl = fetch,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    debug = false,
  } = {}) {

    super({
      enabled,
      fetchImpl,
      cacheTtlMs,
      timeoutMs,
      debug,
    });
  }

  get provider() {
    return 'openalex';
  }

  /**
   * Build OpenAlex request URL.
   */
  buildUrl(query, limit) {

    const url = new URL(
      'https://api.openalex.org/works'
    );

    url.searchParams.set('search', query);
    url.searchParams.set('per_page', String(limit));

    url.searchParams.set(
  'select',
  [
    'id',
    'display_name',
    'publication_year',
    'authorships',
    'doi',
    'cited_by_count',
  ].join(',')
);

    return url;
  }

  /**
   * OpenAlex recommends identifying your application.
   * If you have a contact email, replace the example below.
   */
  buildHeaders() {

    return {
      'User-Agent': 'DistributedResearchScientist/1.0',
    };

  }

  /**
   * Convert OpenAlex response
   * into the common paper format.
   */
  mapResults(payload) {

    const works = payload?.results ?? [];

    return works
      .filter(work => work.display_name)
      .map(work => {

        const url = work.doi
    ? normalizeUrl(work.doi)
    : work.id;

        return normalizePaper({

          title: work.display_name,

          year:
            Number.isFinite(work.publication_year)
              ? work.publication_year
              : null,

          authors:
            (work.authorships ?? [])
              .map(author =>
                author.author?.display_name
              )
              .filter(Boolean),

          url,

          citationCount:
            work.cited_by_count,

          abstract: null,

        });

      })
      .sort(sortByCitation);

  }

}

/**
 * ============================================================================
 * Fallback Paper Source
 * ============================================================================
 */

class FallbackPaperSource {

  constructor(sources = []) {

    this.sources = sources;

    this.lastStatus = {
      enabled: sources.some(source => source.enabled),
      provider: 'none',
      error: null,
      attempted: [],
    };

  }

  /**
   * Search every enabled provider in parallel.
   */
  async search(query, limit = 5) {

    query = normalizeQuery(query);
    limit = clampLimit(limit);

    if (!query)
      return [];

    const enabledSources =
      this.sources.filter(source => source.enabled);

    if (!enabledSources.length) {

      this.lastStatus = {
        enabled: false,
        provider: 'none',
        error: 'No paper sources are enabled.',
        attempted: [],
      };

      return [];
    }

    const settled =
      await Promise.allSettled(
        enabledSources.map(source =>
          source.search(query, limit)
        )
      );

    const papers = [];
    const attempted = [];
    const errors = [];
    const successfulProviders = [];

    settled.forEach((result, index) => {

      const source = enabledSources[index];
      const status = source.status();

      attempted.push(status.provider);

      if (
        result.status === 'fulfilled' &&
        Array.isArray(result.value) &&
        result.value.length
      ) {

        successfulProviders.push(status.provider);
        papers.push(...result.value);

      }

      if (status.error) {

        errors.push({
          provider: status.provider,
          error: status.error,
        });

      }

    });

    const merged =
      mergePaperLists(papers, limit);

    if (merged.length) {

      this.lastStatus = {

        enabled: true,

        provider:
          successfulProviders.join(', '),

        error: null,

        attempted,

      };

      return merged;

    }

    this.lastStatus = {

      enabled: true,

      provider: 'none',

      attempted,

      error:
        errors.length
          ? errors
              .map(e =>
                `[${e.provider}] ${e.error}`
              )
              .join(' | ')
          : 'No papers found.',

    };

    return [];

  }

  /**
   * Provider status.
   */
  status() {

    return this.lastStatus;

  }

}
module.exports = {
  SemanticScholarSource,
  OpenAlexSource,
  FallbackPaperSource,
};