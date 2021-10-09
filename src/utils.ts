import Chart from './chart';
import Player from './player';

export const selectionModeDescriptions: { [index: number]: string } = {
  0: 'By chartkey',
  1: 'By title, subtitle, artist, difficulty meter and filehash',
  2: 'By title, subtitle, artist and filehash'
};

export const selectionModes: { [index: number]: (ch: Chart) => object } = {
  0: (ch: Chart) => ({ chartkey: ch.chartkey }),
  1: (ch: Chart) => ({
    title: ch.title,
    subtitle: ch.subtitle,
    artist: ch.artist,
    difficulty: ch.difficulty,
    meter: ch.meter,
    filehash: ch.filehash
  }),
  2: (ch: Chart) => ({
    title: ch.title,
    subtitle: ch.subtitle,
    artist: ch.artist,
    filehash: ch.filehash
  })
};

export function removeMultiColor(s: string) {
  return s.replace(/(\|c[0-9A-Fa-f]{7}(\s*))*(\|c[0-9A-Fa-f]{7})/g, '$2$3');
}

export function color(c: string) {
  return `|c0${c}`;
}

export const stringToColour = function(str: string) {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  let colour = '';
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-bitwise
    const value = (hash >> (i * 8)) & 0xFF;
    colour += `00${value.toString(16)}`.substr(-2);
  }

  return colour;
};

export function colorize(string: string, colour = stringToColour(string)) {
  return color(colour) + string + color('FFFFFF');
}

export const ownerColor = 'BBFFBB';
export const playerColor = 'AAFFFF';
export const opColor = 'FFBBBB';
export const systemColor = 'BBBBFF';
export const systemPrepend = colorize('System:',systemColor) + " ";

export function unauthorizedChat(player: Player, operator: boolean = false) {
  if (!player.room) {
    // TODO
    // The player is not in a room, but managed to instance a room command - idk how you
    // would want to deal with this.
  } else if (operator) {
    player.sendChat(1, `${systemPrepend}You are not room owner or operator.`, player.room.name);
  } else {
    player.sendChat(1, `${systemPrepend}You are not room owner.`, player.room.name);
  }
}
