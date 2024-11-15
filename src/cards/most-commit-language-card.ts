import {ThemeMap, Theme} from '../const/theme';
import {getCommitLanguage, CommitLanguages} from '../github-api/commits-per-language';
import {createDonutChartCard} from '../templates/donut-chart-card';
import {writeSVG} from '../utils/file-writer';

export const createCommitsPerLanguageCard = async function (username: string, exclude: Array<string>) {
    const statsData = await getCommitsLanguageData(username, exclude);
    for (const themeName of ThemeMap.keys()) {
        const svgString = getCommitsLanguageSVG(statsData, themeName, undefined);
        // output to folder, use 2- prefix for sort in preview
        writeSVG(themeName, '2-most-commit-language', svgString);
    }
};

export const getCommitsLanguageSVGWithThemeName = async function (
    username: string,
    themeName: string,
    customTheme: Theme,
    exclude: Array<string>
): Promise<string> {
    if (!ThemeMap.has(themeName)) throw new Error('Theme does not exist');
    const langData = await getCommitsLanguageData(username, exclude);
    return getCommitsLanguageSVG(langData, themeName, customTheme);
};

const getCommitsLanguageSVG = function (
    langData: {name: string; value: number; color: string}[],
    themeName: string,
    customTheme: Theme | undefined
): string {
    if (langData.length == 0) {
        langData.push({
            name: 'There are no',
            value: 1,
            color: '#586e75'
        });
        langData.push({
            name: 'any commits',
            value: 1,
            color: '#586e75'
        });
        langData.push({
            name: 'in the last year',
            value: 1,
            color: '#586e75'
        });
    }
    let theme = { ...ThemeMap.get(themeName)! };
    if (customTheme !== undefined) {
        if (customTheme.title) theme.title = "#" + customTheme.title;
        if (customTheme.text) theme.text = "#" + customTheme.text;
        if (customTheme.background) theme.background = "#" + customTheme.background;
        if (customTheme.stroke) { theme.stroke = "#" + customTheme.stroke; theme.strokeOpacity = 1; }
        if (customTheme.icon) theme.icon = "#" + customTheme.icon;
        if (customTheme.chart) theme.chart = "#" + customTheme.chart;
    }
    const totalCommits = langData.reduce((sum, lang) => sum + lang.value, 0);

    const chartData = langData;

    let labelData = langData.slice(0, 5);
    if (langData.length > 5) {
        const othersValue = langData.slice(5).reduce((sum, lang) => sum + lang.value, 0);
        labelData.push({
            name: 'Others',
            value: othersValue,
            color: '#808080'
        });
    }
    labelData = labelData.map(lang => ({
        ...lang,
        name: `${lang.name} - ${((lang.value / totalCommits) * 100).toFixed(1)}%`
    }));
    const svgString = createDonutChartCard('Top Languages by Commit', chartData, labelData, theme);
    return svgString;
};

const getCommitsLanguageData = async function (
    username: string,
    exclude: Array<string>
): Promise<{name: string; value: number; color: string}[]> {
    const commitLanguages: CommitLanguages = await getCommitLanguage(username, exclude);
    let langData = [];

    // make a pie data
    for (const [key, value] of commitLanguages.getLanguageMap()) {
        langData.push({
            name: key,
            value: value.count,
            color: value.color
        });
    }
    langData.sort((a, b) => b.value - a.value);
    return langData;
};
