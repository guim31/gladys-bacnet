// -----------------------------------------------------------------------------
// Every text the container sends to Gladys, in the four languages of its
// interface: connection status, configuration mistakes, write failures.
// German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

import { localize } from './i18n.js';

/** Connection status of the Configuration screen, by code of the hub. */
export const STATUS = {
  noAddress: {
    en: 'Enter the IP address of the BACnet/IP device.',
    fr: "Saisissez l'adresse IP de l'équipement BACnet/IP.",
    de: 'Gib die IP-Adresse des BACnet/IP-Geräts ein.',
    es: 'Introduzca la dirección IP del equipo BACnet/IP.',
  },
  badAddress: {
    en: 'The address must be an IP address, e.g. 192.168.1.50 (or 192.168.1.50:47809).',
    fr: "L'adresse doit être une adresse IP, par exemple 192.168.1.50 (ou 192.168.1.50:47809).",
    de: 'Die Adresse muss eine IP-Adresse sein, z. B. 192.168.1.50 (oder 192.168.1.50:47809).',
    es: 'La dirección debe ser una dirección IP, por ejemplo 192.168.1.50 (o 192.168.1.50:47809).',
  },
  badInstance: {
    en: 'The device instance is a whole number from 0 to 4194302 (or empty to read it from the device).',
    fr: "L'instance de l'équipement est un nombre entier de 0 à 4194302 (ou vide pour la lire sur l'équipement).",
    de: 'Die Geräteinstanz ist eine ganze Zahl von 0 bis 4194302 (oder leer, um sie vom Gerät zu lesen).',
    es: 'La instancia del equipo es un número entero de 0 a 4194302 (o vacío para leerla en el equipo).',
  },
  unreachable: {
    en: 'The BACnet device does not answer: check its IP address and port, and that BACnet/IP is on. Retrying.',
    fr: "L'équipement BACnet ne répond pas : vérifiez son adresse IP, son port, et que BACnet/IP est activé. Nouvel essai en cours.",
    de: 'Das BACnet-Gerät antwortet nicht: Prüfe IP-Adresse und Port und ob BACnet/IP aktiv ist. Neuer Versuch läuft.',
    es: 'El equipo BACnet no responde: compruebe su dirección IP, su puerto y que BACnet/IP esté activado. Reintentando.',
  },
  wrongInstance: {
    en: 'The device at this address has no such instance: empty the "Device instance" field to read it. Retrying.',
    fr: "L'équipement à cette adresse n'a pas cette instance : videz le champ « Instance de l'équipement » pour la lire. Nouvel essai en cours.",
    de: 'Das Gerät unter dieser Adresse hat diese Instanz nicht: Leere das Feld „Geräteinstanz“, um sie zu lesen. Neuer Versuch läuft.',
    es: 'El equipo en esta dirección no tiene esta instancia: vacíe el campo «Instancia del equipo» para leerla. Reintentando.',
  },
  noInstance: {
    en: 'The device does not give its instance: enter it in the "Device instance" field. Retrying.',
    fr: "L'équipement ne donne pas son instance : saisissez-la dans le champ « Instance de l'équipement ». Nouvel essai en cours.",
    de: 'Das Gerät nennt seine Instanz nicht: Gib sie im Feld „Geräteinstanz“ ein. Neuer Versuch läuft.',
    es: 'El equipo no indica su instancia: introdúzcala en el campo «Instancia del equipo». Reintentando.',
  },
  portInUse: {
    en: 'The BACnet/IP port of the integration is already in use: restart the integration.',
    fr: "Le port BACnet/IP de l'intégration est déjà utilisé : redémarrez l'intégration.",
    de: 'Der BACnet/IP-Port der Integration ist schon belegt: Starte die Integration neu.',
    es: 'El puerto BACnet/IP de la integración ya está en uso: reinicie la integración.',
  },
  failed: {
    en: 'The BACnet device answered with an error: see the integration logs. Retrying.',
    fr: "L'équipement BACnet a répondu par une erreur : consultez les journaux de l'intégration. Nouvel essai en cours.",
    de: 'Das BACnet-Gerät hat mit einem Fehler geantwortet: Sieh dir die Protokolle der Integration an. Neuer Versuch läuft.',
    es: 'El equipo BACnet respondió con un error: consulte los registros de la integración. Reintentando.',
  },
  initFailed: {
    en: 'The integration could not start: see its logs.',
    fr: "L'intégration n'a pas pu démarrer : consultez ses journaux.",
    de: 'Die Integration konnte nicht starten: Sieh dir ihre Protokolle an.',
    es: 'La integración no pudo iniciarse: consulte sus registros.',
  },
};

/** Mistakes in the "Objects" field (objects.js) and on the device. */
export const OBJECT_ERRORS = {
  noObject: {
    en: 'no object after the name',
    fr: "pas d'objet après le nom",
    de: 'kein Objekt nach dem Namen',
    es: 'falta el objeto después del nombre',
  },
  badObject: {
    en: ({ object }) =>
      `"${object}" is not a supported object (e.g. analog-input:1, binary-value:3, msv:2)`,
    fr: ({ object }) =>
      `« ${object} » n'est pas un objet pris en charge (ex. analog-input:1, binary-value:3, msv:2)`,
    de: ({ object }) =>
      `„${object}“ ist kein unterstütztes Objekt (z. B. analog-input:1, binary-value:3, msv:2)`,
    es: ({ object }) =>
      `«${object}» no es un objeto compatible (p. ej. analog-input:1, binary-value:3, msv:2)`,
  },
  duplicateObject: {
    en: ({ object }) => `${object} is already declared`,
    fr: ({ object }) => `${object} est déjà déclaré`,
    de: ({ object }) => `${object} ist schon deklariert`,
    es: ({ object }) => `${object} ya está declarado`,
  },
  unknownWord: {
    en: ({ word }) => `unknown word "${word}"`,
    fr: ({ word }) => `mot inconnu « ${word} »`,
    de: ({ word }) => `unbekanntes Wort „${word}“`,
    es: ({ word }) => `palabra desconocida «${word}»`,
  },
  unknownUnit: {
    en: ({ unit }) => `unknown unit "${unit}"`,
    fr: ({ unit }) => `unité inconnue « ${unit} »`,
    de: ({ unit }) => `unbekannte Einheit „${unit}“`,
    es: ({ unit }) => `unidad desconocida «${unit}»`,
  },
  badNumber: {
    en: ({ option, value }) => `${option}=${value} is not a valid number`,
    fr: ({ option, value }) => `${option}=${value} n'est pas un nombre valide`,
    de: ({ option, value }) => `${option}=${value} ist keine gültige Zahl`,
    es: ({ option, value }) => `${option}=${value} no es un número válido`,
  },
  kindOfObject: {
    en: ({ kind, object }) => `the kind ${kind} does not fit ${object}`,
    fr: ({ kind, object }) => `la nature ${kind} ne convient pas à ${object}`,
    de: ({ kind, object }) => `die Art ${kind} passt nicht zu ${object}`,
    es: ({ kind, object }) => `el tipo ${kind} no corresponde a ${object}`,
  },
  inputNotWritable: {
    en: ({ object }) => `${object} is an input: BACnet inputs cannot be written`,
    fr: ({ object }) => `${object} est une entrée : une entrée BACnet ne s'écrit pas`,
    de: ({ object }) => `${object} ist ein Eingang: BACnet-Eingänge sind nicht beschreibbar`,
    es: ({ object }) => `${object} es una entrada: una entrada BACnet no se escribe`,
  },
  unitOfKind: {
    en: ({ unit, kind }) => `the unit ${unit} does not fit the kind ${kind}`,
    fr: ({ unit, kind }) => `l'unité ${unit} ne convient pas à la nature ${kind}`,
    de: ({ unit, kind }) => `die Einheit ${unit} passt nicht zur Art ${kind}`,
    es: ({ unit, kind }) => `la unidad ${unit} no corresponde al tipo ${kind}`,
  },
  minMax: {
    en: 'min must be lower than max',
    fr: 'min doit être inférieur à max',
    de: 'min muss kleiner als max sein',
    es: 'min debe ser inferior a max',
  },
  tooMany: {
    en: ({ max }) => `more than ${max} objects: ignored`,
    fr: ({ max }) => `plus de ${max} objets : ignoré`,
    de: ({ max }) => `mehr als ${max} Objekte: ignoriert`,
    es: ({ max }) => `más de ${max} objetos: ignorado`,
  },
  notFound: {
    en: ({ object }) => `${object} does not exist on the device`,
    fr: ({ object }) => `${object} n'existe pas sur l'équipement`,
    de: ({ object }) => `${object} existiert nicht auf dem Gerät`,
    es: ({ object }) => `${object} no existe en el equipo`,
  },
  unreadable: {
    en: ({ object, error }) => `${object} cannot be read (${error})`,
    fr: ({ object, error }) => `${object} ne peut pas être lu (${error})`,
    de: ({ object, error }) => `${object} kann nicht gelesen werden (${error})`,
    es: ({ object, error }) => `${object} no se puede leer (${error})`,
  },
};

/** Failed writes and releases. */
export const WRITE_ERRORS = {
  writeDisabled: {
    en: 'Writing is off: turn on "Allow writing" in the configuration.',
    fr: "L'écriture est désactivée : activez « Autoriser l'écriture » dans la configuration.",
    de: 'Schreiben ist aus: Aktiviere „Schreiben erlauben“ in der Konfiguration.',
    es: 'La escritura está desactivada: active «Permitir la escritura» en la configuración.',
  },
  notDeclaredWritable: {
    en: ({ name }) => `${name} is not declared "write" in the Objects field.`,
    fr: ({ name }) => `${name} n'est pas déclaré « write » dans le champ Objets.`,
    de: ({ name }) => `${name} ist im Feld Objekte nicht als „write“ deklariert.`,
    es: ({ name }) => `${name} no está declarado «write» en el campo Objetos.`,
  },
  unknownObject: {
    en: ({ name }) => `"${name}" is not one of the declared objects.`,
    fr: ({ name }) => `« ${name} » ne fait pas partie des objets déclarés.`,
    de: ({ name }) => `„${name}“ gehört nicht zu den deklarierten Objekten.`,
    es: ({ name }) => `«${name}» no forma parte de los objetos declarados.`,
  },
  notConnected: {
    en: 'The BACnet device is not connected.',
    fr: "L'équipement BACnet n'est pas connecté.",
    de: 'Das BACnet-Gerät ist nicht verbunden.',
    es: 'El equipo BACnet no está conectado.',
  },
  notResolved: {
    en: ({ name }) => `${name} could not be read on the device: run "Check the configuration".`,
    fr: ({ name }) =>
      `${name} n'a pas pu être lu sur l'équipement : lancez « Vérifier la configuration ».`,
    de: ({ name }) =>
      `${name} konnte auf dem Gerät nicht gelesen werden: Starte „Konfiguration prüfen“.`,
    es: ({ name }) => `${name} no se pudo leer en el equipo: ejecute «Comprobar la configuración».`,
  },
  notCommandable: {
    en: ({ name }) => `${name} has no priority array: there is no priority to release.`,
    fr: ({ name }) => `${name} n'a pas de tableau de priorités : aucune priorité à relâcher.`,
    de: ({ name }) => `${name} hat kein Prioritäten-Array: Es gibt keine Priorität freizugeben.`,
    es: ({ name }) => `${name} no tiene tabla de prioridades: no hay prioridad que liberar.`,
  },
  badPriority: {
    en: ({ value }) => `"${value}": the priority is a whole number from 1 to 16.`,
    fr: ({ value }) => `« ${value} » : la priorité est un nombre entier de 1 à 16.`,
    de: ({ value }) => `„${value}“: Die Priorität ist eine ganze Zahl von 1 bis 16.`,
    es: ({ value }) => `«${value}»: la prioridad es un número entero de 1 a 16.`,
  },
  notANumber: {
    en: ({ value }) => `"${value}" is not a number.`,
    fr: ({ value }) => `« ${value} » n'est pas un nombre.`,
    de: ({ value }) => `„${value}“ ist keine Zahl.`,
    es: ({ value }) => `«${value}» no es un número.`,
  },
  notBoolean: {
    en: ({ value }) => `"${value}": expected 0 or 1 (or on / off, active / inactive).`,
    fr: ({ value }) => `« ${value} » : 0 ou 1 attendu (ou on / off, active / inactive).`,
    de: ({ value }) => `„${value}“: 0 oder 1 erwartet (oder on / off, active / inactive).`,
    es: ({ value }) => `«${value}»: se espera 0 o 1 (o on / off, active / inactive).`,
  },
  notAState: {
    en: ({ value, max }) => `"${value}": expected a state from 1 to ${max}, or its text.`,
    fr: ({ value, max }) => `« ${value} » : un état de 1 à ${max} attendu, ou son texte.`,
    de: ({ value, max }) => `„${value}“: Zustand von 1 bis ${max} erwartet, oder sein Text.`,
    es: ({ value, max }) => `«${value}»: se espera un estado de 1 a ${max}, o su texto.`,
  },
  outOfBounds: {
    en: ({ min, max }) => `Outside the bounds declared for this object (${min} to ${max}).`,
    fr: ({ min, max }) => `Hors des bornes déclarées pour cet objet (${min} à ${max}).`,
    de: ({ min, max }) =>
      `Außerhalb der für dieses Objekt deklarierten Grenzen (${min} bis ${max}).`,
    es: ({ min, max }) => `Fuera de los límites declarados para este objeto (${min} a ${max}).`,
  },
  refused: {
    en: ({ error }) => `The device refused the write (${error}).`,
    fr: ({ error }) => `L'équipement a refusé l'écriture (${error}).`,
    de: ({ error }) => `Das Gerät hat das Schreiben abgelehnt (${error}).`,
    es: ({ error }) => `El equipo rechazó la escritura (${error}).`,
  },
  noAnswer: {
    en: 'The device did not answer the write.',
    fr: "L'équipement n'a pas répondu à l'écriture.",
    de: 'Das Gerät hat auf das Schreiben nicht geantwortet.',
    es: 'El equipo no respondió a la escritura.',
  },
  failed: {
    en: ({ detail }) => `The write failed: ${detail}`,
    fr: ({ detail }) => `L'écriture a échoué : ${detail}`,
    de: ({ detail }) => `Das Schreiben ist fehlgeschlagen: ${detail}`,
    es: ({ detail }) => `La escritura falló: ${detail}`,
  },
};

/** "Entry 3 (Fan): ..." */
export const ENTRY_LABEL = {
  en: (entry, name) => `Entry ${entry}${name ? ` (${name})` : ''}`,
  fr: (entry, name) => `Entrée ${entry}${name ? ` (${name})` : ''}`,
  de: (entry, name) => `Eintrag ${entry}${name ? ` (${name})` : ''}`,
  es: (entry, name) => `Entrada ${entry}${name ? ` (${name})` : ''}`,
};

/** The multi-language text of an object error. */
export function objectError({ entry, name, code, params = {} }) {
  const label = localize(ENTRY_LABEL, entry, name);
  const text = localize(OBJECT_ERRORS[code], params);
  return Object.fromEntries(
    Object.keys(text).map((lang) => [lang, `${label[lang]}: ${text[lang]}`]),
  );
}

/** The multi-language text of a write error. */
export function writeError(code, params = {}) {
  return localize(WRITE_ERRORS[code] ?? WRITE_ERRORS.failed, { detail: '?', ...params });
}

/** "write-access-denied" for a BACnet error code (ASHRAE 135 names). */
const ERROR_NAMES = {
  2: 'configuration-in-progress',
  9: 'invalid-data-type',
  25: 'operational-problem',
  27: 'read-access-denied',
  29: 'service-request-denied',
  31: 'unknown-object',
  32: 'unknown-property',
  37: 'value-out-of-range',
  40: 'write-access-denied',
  42: 'invalid-array-index',
  44: 'not-cover-property',
  47: 'property-is-not-an-array',
  50: 'invalid-tag',
};

export function bacnetErrorName(errorCode) {
  return ERROR_NAMES[errorCode] ?? `error ${errorCode}`;
}
