// -----------------------------------------------------------------------------
// The "BACnet device" dashboard widget: the first values of the device as
// live tiles, and the health of the link — answering or not, how many
// objects are in alarm or fault, the last value read. What a plain device box
// cannot say. The status block can be hidden.
//
// Budget of the core: 8 components at most; here up to 6 tiles + 1 status.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { pick } from './i18n.js';

export const WIDGET_KEY = 'device_overview';
const MAX_TILES = 6;

export const TEXT = {
  pick: {
    en: 'Choose the BACnet device in the widget settings.',
    fr: "Choisissez l'équipement BACnet dans les réglages du widget.",
    de: 'Wähle das BACnet-Gerät in den Einstellungen des Widgets.',
    es: 'Elija el equipo BACnet en los ajustes del widget.',
  },
  unknown: {
    en: 'This device is no longer in the integration configuration.',
    fr: "Cet équipement n'est plus dans la configuration de l'intégration.",
    de: 'Dieses Gerät ist nicht mehr in der Konfiguration der Integration.',
    es: 'Este equipo ya no está en la configuración de la integración.',
  },
  link: { en: 'Link', fr: 'Liaison', de: 'Verbindung', es: 'Enlace' },
  connected: { en: 'Answers', fr: 'Répond', de: 'Antwortet', es: 'Responde' },
  disconnected: { en: 'No answer', fr: 'Ne répond pas', de: 'Keine Antwort', es: 'No responde' },
  waiting: { en: 'Connecting', fr: 'Connexion', de: 'Verbindet', es: 'Conectando' },
  alarms: {
    en: 'Alarms, faults',
    fr: 'Alarmes, défauts',
    de: 'Alarme, Störungen',
    es: 'Alarmas, fallos',
  },
  lastValue: { en: 'Last value', fr: 'Dernière valeur', de: 'Letzter Wert', es: 'Último valor' },
  never: { en: 'Never', fr: 'Jamais', de: 'Nie', es: 'Nunca' },
};

/**
 * The content of the widget.
 * @param {import('./hub.js').BacnetHub} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function overviewContent(hub, { settings = {}, language = 'en' } = {}) {
  const lang = ['en', 'fr', 'de', 'es'].includes(language) ? language : 'en';
  if (!settings.device) {
    return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text: TEXT.pick }] };
  }
  if (!hub.ids || settings.device !== hub.ids.device) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: TEXT.unknown }],
    };
  }
  const created = (hub.gladys.devices ?? []).find(
    (device) => device.external_id === settings.device,
  );
  const known = new Set((created?.features ?? []).map((feature) => feature.external_id));
  const components = hub
    .features()
    .map(({ feature }) => feature)
    .filter((feature) => known.size === 0 || known.has(feature.external_id))
    .slice(0, MAX_TILES)
    .map((feature) => ({ type: 'value', device_feature: feature.external_id }));

  const hideStatus = settings.hide_status === true || settings.hide_status === 'true';
  if (!hideStatus) {
    const { connected, lastValueAt } = hub.status;
    const { alarms, total } = hub.counts();
    components.push({
      type: 'status',
      items: [
        {
          label: TEXT.link,
          value: pick(
            connected === true
              ? TEXT.connected
              : connected === false
                ? TEXT.disconnected
                : TEXT.waiting,
            lang,
          ),
          color:
            connected === true
              ? WIDGET_COLORS.SUCCESS
              : connected === false
                ? WIDGET_COLORS.DANGER
                : WIDGET_COLORS.NEUTRAL,
        },
        {
          label: TEXT.alarms,
          value: `${alarms}/${total}`,
          color: alarms > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        },
        {
          label: TEXT.lastValue,
          value: lastValueAt ? clock(lastValueAt, lang) : pick(TEXT.never, lang),
        },
      ],
    });
  }
  if (components.length === 0) {
    components.push({ type: 'text', variant: 'body', text: TEXT.pick });
  }
  return { ttl_seconds: 30, components };
}

/** "14:32:05" in the time zone of Gladys (the supervisor sets TZ). */
function clock(timestamp, lang) {
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}
