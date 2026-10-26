/**
 * Horário de referência para os eventos compartilhados do CHAT.
 *
 * A hora de parede do dispositivo não é usada para criar carimbos de data.
 * A extensão consulta um serviço de horário sincronizado, ancora a resposta
 * em performance.now() e avança usando esse relógio monotônico entre consultas.
 * Os valores são instantes UTC; a interface os exibe no fuso de Brasília.
 */
export const BRASILIA_TIME_ZONE = "America/Sao_Paulo";

const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 4000;

const DEFAULT_PROVIDERS = Object.freeze([
  {
    name: "UTCTime",
    url: "https://utctime.app/api/now",
    readEpoch(payload) {
      const milliseconds = Number(payload?.unix_ms);
      if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
      const iso = Date.parse(payload?.utc_iso ?? payload?.utc_rfc3339 ?? "");
      return Number.isFinite(iso) && iso > 0 ? iso : null;
    },
  },
  {
    name: "Timezone.io",
    url: "https://worldtime.timezone.io/api/timezone/America/Sao_Paulo",
    readEpoch(payload) {
      const localIso = Date.parse(payload?.datetime ?? "");
      if (Number.isFinite(localIso) && localIso > 0) return localIso;
      const milliseconds = Number(payload?.unixtime) * 1000;
      return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
    },
  },
]);

function defaultMonotonicNow() {
  const value = globalThis.performance?.now?.();
  if (!Number.isFinite(value)) {
    throw new Error("Este navegador não disponibiliza um relógio monotônico.");
  }
  return value;
}

/**
 * Criador exportado para permitir testar a sincronização sem usar a rede real.
 * Todos os tempos locais usados aqui são monotônicos e nunca Date.now().
 */
export function createBrasiliaClock({
  fetchImpl = (...args) => globalThis.fetch(...args),
  monotonicNow = defaultMonotonicNow,
  providers = DEFAULT_PROVIDERS,
  syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS,
  maxStaleMs = DEFAULT_MAX_STALE_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  let anchor = null;
  let syncInFlight = null;
  let lastIssuedTimestamp = 0;

  function readMonotonic() {
    const value = Number(monotonicNow());
    if (!Number.isFinite(value)) {
      throw new Error("Não foi possível ler o relógio monotônico do navegador.");
    }
    return value;
  }

  async function requestProvider(provider) {
    const startedAt = readMonotonic();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      // Evita que uma resposta atual de uma segunda atrás seja reutilizada por
      // uma camada de cache intermediária. O parâmetro é aleatório, não temporal.
      const separator = provider.url.includes("?") ? "&" : "?";
      const requestUrl = `${provider.url}${separator}_=${Math.random().toString(36).slice(2)}`;
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response?.ok) throw new Error(`${provider.name}: resposta HTTP ${response?.status ?? "inválida"}.`);
      const payload = await response.json();
      const finishedAt = readMonotonic();
      const epochMs = provider.readEpoch(payload);
      if (!Number.isFinite(epochMs) || epochMs <= 0) {
        throw new Error(`${provider.name}: a resposta não contém um horário válido.`);
      }
      // A resposta é gerada durante a ida e volta da requisição. Ancorá-la no
      // ponto médio reduz o erro médio causado pelo atraso da rede.
      return {
        epochMs,
        anchorPerf: startedAt + (finishedAt - startedAt) / 2,
        syncedAtPerf: finishedAt,
        provider: provider.name,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function synchronize({ force = false } = {}) {
    const before = readMonotonic();
    if (anchor && !force && before - anchor.syncedAtPerf < syncIntervalMs) return anchor;
    if (syncInFlight) return syncInFlight;

    const operation = (async () => {
      const errors = [];
      for (const provider of providers) {
        try {
          anchor = await requestProvider(provider);
          return anchor;
        } catch (error) {
          errors.push(error);
        }
      }
      const error = new Error(
        "Não foi possível consultar o horário de referência de Brasília. Verifique a conexão e tente enviar a mensagem novamente.",
      );
      error.causes = errors;
      throw error;
    })();

    syncInFlight = operation;
    try {
      return await operation;
    } finally {
      if (syncInFlight === operation) syncInFlight = null;
    }
  }

  async function now() {
    let currentPerf = readMonotonic();
    if (!anchor || currentPerf - anchor.syncedAtPerf >= syncIntervalMs) {
      try {
        await synchronize({ force: true });
      } catch (error) {
        currentPerf = readMonotonic();
        // Se a rede cair depois de uma sincronização bem-sucedida, continua-se
        // a partir da última hora validada, sem consultar o relógio do aparelho.
        if (!anchor || currentPerf - anchor.syncedAtPerf > maxStaleMs) throw error;
      }
    }

    currentPerf = readMonotonic();
    const estimatedEpoch = Math.round(anchor.epochMs + (currentPerf - anchor.anchorPerf));
    // Garante que mensagens sequenciais do mesmo cliente nunca recebam a
    // mesma marca temporal nem retrocedam se uma nova amostra variar alguns ms.
    lastIssuedTimestamp = Math.max(estimatedEpoch, lastIssuedTimestamp + 1);
    return lastIssuedTimestamp;
  }

  return { now, synchronize };
}

const brasiliaClock = createBrasiliaClock();

export function getBrasiliaTimestamp() {
  return brasiliaClock.now();
}

export function synchronizeBrasiliaClock() {
  return brasiliaClock.synchronize({ force: true });
}
