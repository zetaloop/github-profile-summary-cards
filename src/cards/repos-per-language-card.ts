import {ThemeMap} from '../const/theme';
import {getRepoLanguages} from '../github-api/repos-per-language';
import {createDonutChartCard} from '../templates/donut-chart-card';
import {writeSVG} from '../utils/file-writer';

export const createReposPerLanguageCard = async function (username: string, exclude: Array<string>) {
    const langData = await getRepoLanguageData(username, exclude);
    for (const themeName of ThemeMap.keys()) {
        const svgString = getReposPerLanguageSVG(langData, themeName);
        // output to folder, use 1- prefix for sort in preview
        writeSVG(themeName, '1-repos-per-language', svgString);
    }
};

export const getReposPerLanguageSVGWithThemeName = async function (
    username: string,
    themeName: string,
    exclude: Array<string>,
    noBg: boolean,
    noStroke: boolean
) {
    if (!ThemeMap.has(themeName)) throw new Error('Theme does not exist');
    const langData = await getRepoLanguageData(username, exclude);
    return getReposPerLanguageSVG(langData, themeName, noBg, noStroke);
};

const getReposPerLanguageSVG = function (langData: { name: string; value: number; color: string }[], themeName: string, noBg = false, noStroke = false) {
    var theme = ThemeMap.get(themeName)!;
    if (noBg) {
        theme.background = 'transparent';
    }
    if (noStroke) {
        theme.strokeOpacity = 0;
    }
    const svgString = createDonutChartCard('Top Languages by Repo', langData, theme);
    return svgString;
};

const getRepoLanguageData = async function (username: string, exclude: Array<string>) {
    const repoLanguages = await getRepoLanguages(username, exclude);
    let langData = [];

    // make a pie data
    for (const [key, value] of repoLanguages.getLanguageMap()) {
        langData.push({
            name: key,
            value: value.count,
            color: value.color
        });
    }
    langData.sort(function (a, b) {
        return b.value - a.value;
    });
    langData = langData.slice(0, 5); // get top 5
    return langData;
};
