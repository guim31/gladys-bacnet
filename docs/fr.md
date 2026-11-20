# BACnet/IP

Lit et écrit les objets d'un équipement BACnet/IP : centrales de traitement
d'air, pompes à chaleur et groupes froids, régulateurs de pièce ou de
chaufferie, compteurs, passerelles BACnet (Siemens Desigo, Daikin, Flexit,
Distech, Honeywell…). Chaque objet déclaré devient une fonctionnalité d'un
appareil Gladys.

**Développée sans équipement de bâtiment réel** : testée contre le serveur de
démonstration de bacnet-stack. Vos retours sont les bienvenus, sur le forum ou
dans les issues du dépôt.

## Ce que vous obtenez

- Un appareil Gladys par équipement BACnet, une fonctionnalité par objet
  déclaré : les objets analogiques en nombres avec leur unité (température,
  humidité, pression, CO2, puissance, énergie en kWh…), les objets binaires en
  marche/arrêt, les objets multi-états en numéro d'état ou en texte de l'état
  (« Confort », « Nuit »).
- Les valeurs lues à l'intervalle choisi, seuls les changements envoyés à
  Gladys.
- L'écriture, désactivée par défaut : marche/arrêt et consignes de température
  depuis le tableau de bord, « Écrire une valeur » et « Relâcher une priorité »
  pour tout objet déclaré, à la priorité BACnet choisie.
- Des déclencheurs de scène quand l'équipement est perdu ou revient, et quand
  un objet passe en alarme ou en défaut.
- Un widget de tableau de bord avec les premières valeurs et l'état de la
  liaison.

Par rapport à l'intégration Flexit (`LM1LC3N7/gladys-flexit`), faite pour les
centrales de ventilation Flexit avec leurs objets déjà associés, celle-ci parle
à tout équipement BACnet/IP : c'est vous qui choisissez les objets.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un équipement qui parle BACnet/IP (UDP, port 47808 par défaut) avec une
  adresse IP fixe, joignable depuis le serveur Gladys. Un équipement BACnet
  MS/TP (RS-485) demande un routeur ou une passerelle BACnet/IP.
- Son instance d'équipement, si l'équipement ne la donne pas (la plupart la
  donnent).

## Configuration

Intégrations → BACnet/IP → Configuration. Enregistrez après chaque étape :
l'état en haut de l'écran dit si l'équipement répond.

### Équipement

- **Adresse IP** : l'adresse de l'équipement ou de sa passerelle BACnet/IP. Un
  port autre que 47808 peut la suivre (`192.168.1.50:47809`) ou aller dans
  **Port UDP**.
- **Instance de l'équipement** : laissez-la vide, l'intégration la lit sur
  l'équipement (instance joker 4194303). Saisissez-la quand l'équipement ne
  répond pas à cette demande, ou derrière une passerelle qui sert plusieurs
  équipements.

L'intégration n'envoie ses requêtes qu'à cette adresse (unicast) : Gladys la
fait tourner sur un réseau en pont, d'où un Who-Is en broadcast n'atteint pas
le réseau du bâtiment. Il n'y a pas de découverte automatique.

### Objets

Appuyez sur **Lister les objets** : la liste d'objets de l'équipement est lue,
et les objets analogiques, binaires et multi-états sont donnés avec leur nom,
prêts à copier. Remplissez ensuite **Objets**, entrées séparées par des
points-virgules :

```
Nom: type:instance [nature] [write] [options]
```

```
Soufflage: ai:1; Reprise: ai:2; Ventilateur: bo:1 switch; Mode: msv:1 text
```

- **Nom** (facultatif, suivi de deux-points et d'une espace) : le nom de la
  fonctionnalité. Sans lui, l'objectName de l'équipement est utilisé.
- **type:instance** : `analog-input:1` ou `ai:1`, `analog-output` (`ao`),
  `analog-value` (`av`), `binary-input` (`bi`), `binary-output` (`bo`),
  `binary-value` (`bv`), `multi-state-input` (`msi`), `multi-state-output`
  (`mso`), `multi-state-value` (`msv`). `AI1` et `OBJECT_ANALOG_INPUT:1`
  fonctionnent aussi.
- **nature** (facultative) : par défaut elle suit les unités BACnet de l'objet
  (°C → temperature, %HR → humidity, Pa → pressure, kWh → energy…). Natures :
  `temperature`, `humidity`, `pressure`, `co2`, `illuminance`, `power`,
  `energy`, `voltage`, `current`, `volume`, `duration`, `value` (tout nombre),
  `setpoint` (température modifiable), `binary`, `switch` (marche/arrêt
  modifiable), `state` (numéro de l'état), `text` (texte de l'état).
- **write** : l'objet peut être écrit (sorties et valeurs seulement : une entrée
  BACnet ne s'écrit pas).
- **Options** : `unit=` (°C, %, Pa, kPa, bar, ppm, W, kW, Wh, kWh, V, A, L, m3,
  s, min, h…), `scale=` et `offset=` (valeur × scale + offset), `min=` et `max=`
  (bornes d'une écriture et de la jauge), `precision=` (décimales).

Jusqu'à 100 objets. **Vérifier la configuration** liste les erreurs entrée par
entrée. Ajoutez ensuite l'équipement depuis l'onglet **Découverte**.

### Intervalle de lecture

Toutes les 10 s, 30 s (par défaut), 1 min ou 5 min, avec une requête
ReadPropertyMultiple pour 8 objets ; un équipement sans ce service est lu
propriété par propriété. Gladys accepte 300 valeurs par minute : avec beaucoup
d'objets, l'intervalle s'allonge (100 objets : toutes les 25 s au moins).

### Écriture

Activez **Autoriser l'écriture** et déclarez `write` les objets que Gladys peut
modifier. Écrire un mauvais objet peut arrêter ou abîmer une installation : ne
déclarez que ce que Gladys doit modifier, et vérifiez avec l'installateur.

BACnet commande sorties et valeurs par 16 priorités : 1 est la plus forte
(sécurité des personnes), 16 la plus faible. La valeur de plus forte priorité
l'emporte ; une valeur écrite à une priorité reste jusqu'à ce qu'elle soit
relâchée. **Priorité d'écriture** vaut 8 (opérateur manuel) par défaut ; évitez
1 à 5. Relâcher une priorité (écrire `null`) rend la main à la priorité
suivante, ou à la valeur par défaut de l'objet. Un objet sans tableau de
priorités (beaucoup de valeurs analogiques et binaires) prend la valeur
directement et n'a rien à relâcher.

Depuis le tableau de bord, seuls les objets `switch` et `setpoint` sont des
commandes (une entrée marche/arrêt et une température cible, jamais un
interrupteur ou un thermostat pilotable à la voix). Tout autre objet déclaré
s'écrit avec les actions.

## Actions

- **Lister les objets** : jusqu'à 60 objets utilisables avec leur nom.
- **Vérifier la configuration** : si l'équipement répond, et les erreurs.
- **Écrire une valeur** : un objet (son nom ou `av:3`), une valeur (un nombre,
  0 / 1 ou on / off, un numéro d'état ou son texte), une priorité facultative.
- **Relâcher une priorité** : un objet et une priorité facultative.

## Scènes

- Déclencheurs : **L'équipement BACnet est perdu** (avec l'erreur),
  **L'équipement BACnet est revenu**, **Un objet BACnet passe en alarme**
  (statusFlags en alarme ou en défaut, une fois jusqu'à sa disparition ; le nom
  de l'objet et l'indicateur sont des variables).
- Actions : **Écrire un objet BACnet** et **Relâcher une priorité BACnet**,
  mêmes champs que les boutons. Un refus fait échouer l'action, pas la scène.
- Chaque fonctionnalité marche aussi avec les déclencheurs habituels des
  appareils Gladys (une température au-dessus d'un seuil, un ventilateur qui
  s'arrête).

## Tableau de bord

Le widget **Équipement BACnet** affiche les six premières valeurs de
l'équipement et un bloc d'état : si l'équipement répond, les objets en alarme
ou en défaut, l'heure de la dernière valeur. Le bloc d'état peut être masqué
dans les réglages du widget.

## Limites

- Pas de découverte Who-Is, pas d'abonnement COV : les valeurs sont lues
  périodiquement.
- Un équipement BACnet par installation de l'intégration.
- Seulement les objets analogiques, binaires et multi-états ; ni plannings, ni
  historiques, ni calendriers, ni acquittement d'alarme.
- Ni BBMD ni enregistrement en « foreign device » : l'équipement doit être
  joignable en unicast depuis le serveur Gladys.
- L'intégration écoute le port UDP 47808 dans son conteneur. Un équipement qui
  répond au port 47808 de l'émetteur plutôt qu'au port d'où vient la requête
  peut ne pas passer la traduction d'adresses de Docker.

## Dépannage

- « Ne répond pas » : vérifiez l'adresse et le port, que BACnet/IP est activé
  dans l'équipement, et qu'aucun pare-feu ne bloque l'UDP 47808 entre Gladys et
  l'équipement.
- « N'a pas cette instance » : videz **Instance de l'équipement**, ou saisissez
  celle donnée par l'outil de l'installateur.
- Un objet « n'existe pas » : comparez avec **Lister les objets**.
- « L'équipement a refusé l'écriture (write-access-denied) » : l'objet est en
  lecture seule, hors service, ou l'équipement demande un mot de passe.
- Tout le détail avec la variable `LOG_LEVEL=debug` dans les journaux de
  l'intégration.

## Crédits

- [@bacnet-js/client](https://github.com/bacnet-js/client) (MIT), la pile
  BACnet en JavaScript maintenue par Innovation-System, fork de `node-bacstack`
  de Fabio Huser.
- [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) de Steve Karg,
  dont le serveur de démonstration a servi aux tests.
- BACnet® est une marque déposée de l'ASHRAE. Cette intégration n'est affiliée
  ni à l'ASHRAE ni à aucun fabricant d'équipements.
