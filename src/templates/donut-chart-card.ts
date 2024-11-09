import {Card} from './card';
import * as d3 from 'd3';
import {PieArcDatum} from 'd3-shape';
import {Theme} from '../const/theme';

export function createDonutChartCard(
    title: string,
    data: {name: string; value: number; color: string}[],
    labelData: {name: string; color: string}[],
    theme: Theme
) {
    const pie = d3.pie<{name: string; value: number; color: string}>().value(function (d) {
        return d.value;
    });
    const pieData = pie(data);
    const card = new Card(title, 340, 200, theme);

    const margin = 10;
    const radius = (Math.min(card.width, card.height) - 2 * margin - card.yPadding) / 2;

    const arc = d3
        .arc<PieArcDatum<{name: string; value: number; color: string}>>()
        .outerRadius(radius - 10)
        .innerRadius(radius / 2);

    const svg = card.getSVG();
    // draw language node

    const panel = svg.append('g').attr('transform', `translate(${card.xPadding + margin},${0})`);
    const labelHeight = 14;
    panel
        .selectAll(null)
        .data(labelData)
        .enter()
        .append('rect')
        .attr('y', (d, i) => labelHeight * i * 1.8 + card.height / 2 - radius - 12) // rect y-coordinate need fix,so I decrease y, but I don't know why this need fix.
        .attr('width', labelHeight)
        .attr('height', labelHeight)
        .attr('fill', labelData => labelData.color)
        .attr('stroke', `${theme.background}`)
        .style('stroke-width', '1px');

    // set language text
    panel
        .selectAll(null)
        .data(labelData)
        .enter()
        .append('text')
        .attr('x', labelHeight * 1.2)
        .attr('y', (d, i) => labelHeight * i * 1.8 + card.height / 2 - radius)
        .style('font-size', `${labelHeight}px`)
        .each(function (d) {
            const [mainText, subText] = d.name.split(' - ');
            d3.select(this)
                .append('tspan')
                .text(mainText)
                .style('fill', theme.text);
            if (subText) {
                d3.select(this)
                    .append('tspan')
                    .text(' - ' + subText)
                    .style('fill', theme.text + 'a0')
            }
        });

    // draw pie chart
    const g = svg
        .append('g')
        .attr(
            'transform',
            `translate( ${card.width - radius - margin - card.xPadding}, ${(card.height - card.yPadding) / 2} )`
        )
        .selectAll('.arc')
        .data(pieData)
        .enter()
        .append('g')
        .attr('class', 'arc');

    g.append('path')
        .attr('d', arc)
        .style('fill', function (pieData) {
            return pieData.data.color;
        })
        .attr('stroke', `${theme.background}`)
        .style('stroke-width', '2px');
    return card.toString();
}
