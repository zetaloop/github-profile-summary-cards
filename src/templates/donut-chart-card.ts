import {Card} from './card';
import * as d3 from 'd3';
import {Theme} from '../const/theme';

export function createDonutChartCard(
    title: string,
    data: {name: string; value: number; color: string}[],
    theme: Theme,
    labelData: {name: string; value?: number | string; color: string}[] = data.map(({name, color}) => ({name, color}))
) {
    const pie = d3.pie<{name: string; value: number; color: string}>().value(function (d) {
        return d.value;
    });
    const pieData = pie(data);
    const card = new Card(title, 340, 200, theme);

    const margin = 10;
    const radius = (Math.min(card.width, card.height) - 2 * margin - card.yPadding) / 2;

    const arc = d3
        .arc<d3.PieArcDatum<{name: string; value: number; color: string}>>()
        .outerRadius(radius - 10)
        .innerRadius(radius / 2);

    const svg = card.getSVG();
    // draw language node

    const panel = svg.append('g').attr('transform', `translate(${card.xPadding + margin},${0})`);
    const labelHeight = 13;
    panel
        .selectAll(null)
        .data(labelData)
        .enter()
        .append('rect')
        .attr('y', (d, i) => labelHeight * i * 1.7 + card.height / 2 - radius - 11) // rect y-coordinate need fix,so I decrease y, but I don't know why this need fix.
        .attr('width', labelHeight)
        .attr('height', labelHeight)
        // Each language's legend swatch + label is an animatable item (shares --gpsc-i
        // with its arc) so a language reveals as one unit, one at a time.
        .attr('class', 'gpsc-item')
        .style('--gpsc-i', (d, i) => String(i))
        .attr('fill', d => d.color)
        .attr('stroke', `${theme.background}`)
        .style('stroke-width', '1px');

    // set language text
    const nodes = panel
        .selectAll(null)
        .data(labelData)
        .enter()
        .append('text')
        .attr('x', labelHeight * 1.2)
        .attr('y', (d, i) => labelHeight * i * 1.7 + card.height / 2 - radius)
        .attr('class', 'gpsc-item')
        .style('--gpsc-i', (d, i) => String(i))
        .style('fill', theme.text)
        .style('font-size', `${labelHeight}px`);

    nodes.each(function (d, index) {
        const node = d3.select(nodes.nodes()[index]);
        node.append('tspan').text(d.name).style('fill', theme.text);
        if (d.value !== undefined) {
            node.append('tspan')
                .text(` - ${d.value}`)
                .style('fill', theme.text + 'a0');
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
        .attr('class', 'arc')
        // Per-arc index for staggered ("one-by-one") reveal animations. Inert unless an
        // animation preset references --gpsc-i; see src/utils/animation.ts.
        .style('--gpsc-i', (d: d3.PieArcDatum<{name: string; value: number; color: string}>) => String(d.index));

    g.append('path')
        .attr('d', arc)
        .style('fill', function (pieData) {
            return pieData.data.color;
        })
        .attr('stroke', `${theme.background}`)
        .style('stroke-width', '2px');
    return card.toString();
}
