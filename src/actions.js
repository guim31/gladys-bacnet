// -----------------------------------------------------------------------------
// The buttons of the Configuration screen and the scene actions.
//
// - "List the objects" reads the objectList of the device and gives the
//   objects Gladys can use, with their name, ready to copy.
// - "Check the configuration" says whether the device answers and lists the
//   mistakes entry by entry.
// - "Write a value" and "Release a priority" (buttons and scene actions)
//   command a declared object.
//
// Gladys shows in green what a handler returns and in red what it throws:
// every failure throws an ActionFailure carrying the four languages.
// -----------------------------------------------------------------------------

import { PROPERTY } from './bacnet/client.js';
import { byLanguage, joinLines, localize } from './i18n.js';
import { STATUS, writeError } from './messages.js';
import { OBJECT_TYPES } from './objects.js';
import { WriteError } from './values.js';

export const ACTION_KEYS = {
  LIST_OBJECTS: 'list_objects',
  CHECK_CONFIG: 'check_config',
  WRITE_VALUE: 'write_value',
  RELEASE_VALUE: 'release_value',
};
export const SCENE_ACTION_KEYS = { WRITE_VALUE: 'write_value', RELEASE_VALUE: 'release_value' };

const MAX_LINES = 60;

export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

export const ACTION_TEXT = {
  notConnected: {
    en: 'The BACnet device is not connected:',
    fr: "L'équipement BACnet n'est pas connecté :",
    de: 'Das BACnet-Gerät ist nicht verbunden:',
    es: 'El equipo BACnet no está conectado:',
  },
  listFailed: {
    en: ({ detail }) => `Reading the object list failed: ${detail}`,
    fr: ({ detail }) => `La lecture de la liste des objets a échoué : ${detail}`,
    de: ({ detail }) => `Das Lesen der Objektliste ist fehlgeschlagen: ${detail}`,
    es: ({ detail }) => `La lectura de la lista de objetos falló: ${detail}`,
  },
  nothingFound: {
    en: 'The device has no analog, binary or multi-state object.',
    fr: "L'équipement n'a aucun objet analogique, binaire ou multi-état.",
    de: 'Das Gerät hat kein analoges, binäres oder Multi-State-Objekt.',
    es: 'El equipo no tiene ningún objeto analógico, binario o multiestado.',
  },
  found: {
    en: ({ count, total, instance }) =>
      `Device ${instance}: ${count} usable object(s) of ${total}, as Name: object:`,
    fr: ({ count, total, instance }) =>
      `Équipement ${instance} : ${count} objet(s) utilisable(s) sur ${total}, sous la forme Nom: objet :`,
    de: ({ count, total, instance }) =>
      `Gerät ${instance}: ${count} nutzbare(s) Objekt(e) von ${total}, als Name: Objekt:`,
    es: ({ count, total, instance }) =>
      `Equipo ${instance}: ${count} objeto(s) utilizable(s) de ${total}, como Nombre: objeto:`,
  },
  truncated: {
    en: ({ max }) => `Only the first ${max} are shown.`,
    fr: ({ max }) => `Seuls les ${max} premiers sont affichés.`,
    de: ({ max }) => `Nur die ersten ${max} werden angezeigt.`,
    es: ({ max }) => `Solo se muestran los ${max} primeros.`,
  },
  connected: {
    en: ({ instance, count, total }) =>
      `Connected to device ${instance}: ${count} of ${total} object(s) read.`,
    fr: ({ instance, count, total }) =>
      `Connecté à l'équipement ${instance} : ${count} objet(s) lu(s) sur ${total}.`,
    de: ({ instance, count, total }) =>
      `Mit Gerät ${instance} verbunden: ${count} von ${total} Objekt(en) gelesen.`,
    es: ({ instance, count, total }) =>
      `Conectado al equipo ${instance}: ${count} de ${total} objeto(s) leído(s).`,
  },
  noObject: {
    en: 'No object declared yet: use "List the objects", then fill the Objects field.',
    fr: 'Aucun objet déclaré : utilisez « Lister les objets », puis remplissez le champ Objets.',
    de: 'Noch kein Objekt deklariert: Nutze „Objekte auflisten“ und fülle dann das Feld Objekte.',
    es: 'Ningún objeto declarado: utilice «Listar los objetos» y luego rellene el campo Objetos.',
  },
  allGood: {
    en: 'No mistake in the objects.',
    fr: 'Aucune erreur dans les objets.',
    de: 'Kein Fehler in den Objekten.',
    es: 'Ningún error en los objetos.',
  },
  mistakes: { en: 'Mistakes:', fr: 'Erreurs :', de: 'Fehler:', es: 'Errores:' },
  written: {
    en: ({ name, value, priority }) => `${name}: ${value} written at priority ${priority}.`,
    fr: ({ name, value, priority }) => `${name} : ${value} écrit en priorité ${priority}.`,
    de: ({ name, value, priority }) => `${name}: ${value} mit Priorität ${priority} geschrieben.`,
    es: ({ name, value, priority }) => `${name}: ${value} escrito con prioridad ${priority}.`,
  },
  released: {
    en: ({ name, priority }) => `${name}: priority ${priority} released.`,
    fr: ({ name, priority }) => `${name} : priorité ${priority} relâchée.`,
    de: ({ name, priority }) => `${name}: Priorität ${priority} freigegeben.`,
    es: ({ name, priority }) => `${name}: prioridad ${priority} liberada.`,
  },
  noObjectName: {
    en: 'Give the name or the identifier (e.g. av:3) of a declared object.',
    fr: "Indiquez le nom ou l'identifiant (ex. av:3) d'un objet déclaré.",
    de: 'Gib den Namen oder die Kennung (z. B. av:3) eines deklarierten Objekts an.',
    es: 'Indique el nombre o el identificador (p. ej. av:3) de un objeto declarado.',
  },
  noValue: {
    en: 'Give the value to write.',
    fr: 'Indiquez la valeur à écrire.',
    de: 'Gib den zu schreibenden Wert an.',
    es: 'Indique el valor que se va a escribir.',
  },
};

/** The status message of a device that is not connected, as an ActionFailure. */
function notConnected(hub) {
  const reason = hub.statusMessage() ?? localize(STATUS.unreachable);
  return new ActionFailure(joinLines([ACTION_TEXT.notConnected, reason]));
}

/** "List the objects". */
export async function listObjects(hub) {
  if (!hub.address) {
    throw new ActionFailure(hub.statusMessage() ?? localize(STATUS.noAddress));
  }
  if (!hub.link || hub.status.connected !== true || hub.instance === null) {
    throw notConnected(hub);
  }
  let usable;
  let total;
  let names;
  try {
    const list = await hub.link.readObjectList(hub.instance);
    total = list.total;
    usable = list.ids.filter((id) => OBJECT_TYPES[id?.type]);
    const shown = usable.slice(0, MAX_LINES);
    const results = await hub.link.readObjects(
      shown.map((objectId) => ({ objectId, properties: [PROPERTY.OBJECT_NAME] })),
    );
    names = results.map((result) => result[PROPERTY.OBJECT_NAME]?.values?.[0]);
  } catch (err) {
    throw new ActionFailure(
      localize(ACTION_TEXT.listFailed, { detail: String(err.message).slice(0, 120) }),
    );
  }
  if (usable.length === 0) {
    throw new ActionFailure(localize(ACTION_TEXT.nothingFound));
  }
  const lines = [
    localize(ACTION_TEXT.found, { count: usable.length, total, instance: hub.instance }),
  ];
  usable.slice(0, MAX_LINES).forEach((id, index) => {
    const name = typeof names[index] === 'string' && names[index].trim() ? names[index].trim() : '';
    const text = `${OBJECT_TYPES[id.type].slug}:${id.instance}`;
    lines.push(byLanguage(() => (name ? `${name.replace(/[;:]/g, ' ')}: ${text}` : text)));
  });
  if (usable.length > MAX_LINES) {
    lines.push(localize(ACTION_TEXT.truncated, { max: MAX_LINES }));
  }
  return joinLines(lines);
}

/** "Check the configuration". */
export async function checkConfig(hub) {
  if (!hub.address) {
    throw new ActionFailure(hub.statusMessage() ?? localize(STATUS.noAddress));
  }
  const problems = hub.problems();
  if (hub.status.connected !== true) {
    throw new ActionFailure(
      joinLines([
        ACTION_TEXT.notConnected,
        hub.statusMessage() ?? localize(STATUS.unreachable),
        ...(problems.length > 0 ? [ACTION_TEXT.mistakes, ...problems] : []),
      ]),
    );
  }
  if (hub.objects.length === 0 && problems.length === 0) {
    throw new ActionFailure(localize(ACTION_TEXT.noObject));
  }
  const header = localize(ACTION_TEXT.connected, {
    instance: hub.instance,
    count: hub.counts().total,
    total: hub.objects.length + hub.configErrors.length,
  });
  if (problems.length > 0) {
    throw new ActionFailure(joinLines([header, ACTION_TEXT.mistakes, ...problems]));
  }
  return joinLines([header, ACTION_TEXT.allGood]);
}

function targetOf(hub, fields) {
  const target = String(fields.object ?? '').trim();
  if (target === '') {
    throw new ActionFailure(localize(ACTION_TEXT.noObjectName));
  }
  const object = hub.findObject(target);
  if (!object) {
    throw new ActionFailure(writeError('unknownObject', { name: target }));
  }
  return object;
}

async function guarded(run) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof WriteError) {
      throw new ActionFailure(writeError(err.code, err.params));
    }
    throw err;
  }
}

/** "Write a value", from the button or a scene. */
export async function writeValue(hub, fields = {}) {
  const object = targetOf(hub, fields);
  const value =
    fields.value === undefined || fields.value === null ? '' : String(fields.value).trim();
  if (value === '') {
    throw new ActionFailure(localize(ACTION_TEXT.noValue));
  }
  const result = await guarded(() => hub.write(object, value, fields.priority));
  return localize(ACTION_TEXT.written, {
    name: result.name,
    value: result.shown,
    priority: result.priority,
  });
}

/** "Release a priority", from the button or a scene. */
export async function releaseValue(hub, fields = {}) {
  const object = targetOf(hub, fields);
  const result = await guarded(() => hub.release(object, fields.priority));
  return localize(ACTION_TEXT.released, result);
}
