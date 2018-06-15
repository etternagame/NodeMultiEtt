/// <reference path="references.ts" />
namespace Utils {
  export const selectionModeDescriptions: { [index: number]: string } = {
    0: 'By chartkey',
    1: 'By title, subtitle, artist, difficulty meter and filehash',
    2: 'By title, subtitle, artist and filehash'
  };

  export const selectionModes: { [index: number]: (ch: Chart.Chart) => object } = {
    0: (ch: Chart.Chart) => ({ chartkey: ch.chartkey }),
    1: (ch: Chart.Chart) => ({
      title: ch.title,
      subtitle: ch.subtitle,
      artist: ch.artist,
      difficulty: ch.difficulty,
      meter: ch.meter,
      filehash: ch.filehash
    }),
    2: (ch: Chart.Chart) => ({
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

  export const systemPrepend = `${color('BBBBFF')}System:${color('FFFFFF')} `;
  export const ownerColor = 'BBFFBB';
  export const playerColor = 'AAFFFF';
  export const opColor = 'FFBBBB';

  export const stringToColour = function(str: string) {
    let hash = 0;

    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    let colour = '';
    for (let i = 0; i < 3; i++) {
      let value = (hash >> (i * 8)) & 0xff;
      colour += ('00' + value.toString(16)).substr(-2);
    }

    return colour;
  };

  export function colorize(string: string, colour = stringToColour(string)) {
    return color(colour) + string + color('FFFFFF');
  }
}
