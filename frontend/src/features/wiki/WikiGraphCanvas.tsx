import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { WikiGraph } from '../../shared/types/workspace'

type GraphNode = d3.SimulationNodeDatum & {
  id: string
  label: string
  status: string
}

type GraphLink = d3.SimulationLinkDatum<GraphNode> & { id: string }

type NodeSel = d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>

export function WikiGraphCanvas({
  graph,
  activePageId,
  onSelectPage,
}: {
  graph: WikiGraph
  activePageId: string | null
  onSelectPage: (id: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const onSelectPageRef = useRef(onSelectPage)
  const nodeSelRef = useRef<NodeSel | null>(null)
  const activePageIdRef = useRef(activePageId)

  useEffect(() => { onSelectPageRef.current = onSelectPage })
  useEffect(() => { activePageIdRef.current = activePageId })

  // Rebuild the simulation only when the graph data changes.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return

    nodeSelRef.current = null
    const width = el.clientWidth || 288
    const height = el.clientHeight || 288

    const svg = d3.select(el)
    svg.selectAll('*').remove()

    if (graph.nodes.length === 0) return

    const container = svg.append('g')

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => container.attr('transform', event.transform)),
    )

    const nodes: GraphNode[] = graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      status: n.status ?? 'draft',
    }))

    const nodeById = new Map(nodes.map((n) => [n.id, n]))

    const links: GraphLink[] = graph.edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, target: e.target }))

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3.forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(60)
          .strength(0.5),
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(18))

    const linkSel = container
      .append('g')
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', '#d4d4d0')
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.8)

    const nodeSel = container
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => onSelectPageRef.current(d.id))
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          }),
      )

    const currentActiveId = activePageIdRef.current
    nodeSel
      .append('circle')
      .attr('r', (d) => (d.id === currentActiveId ? 8 : 5))
      .attr('fill', (d) => (d.status === 'published' ? '#10b981' : '#f59e0b'))
      .attr('stroke', (d) => (d.id === currentActiveId ? '#0f0f0f' : '#ffffff'))
      .attr('stroke-width', (d) => (d.id === currentActiveId ? 2 : 1))
      

    nodeSel
      .append('text')
      .text((d) => d.label)
      .attr('font-size', 9)
      .attr('fill', (d) => (d.id === currentActiveId ? '#0f0f0f' : '#5a5a56'))
      .attr('text-anchor', 'middle')
      .attr('dy', 17)
      .style('pointer-events', 'none')
      .style('user-select', 'none')

    nodeSelRef.current = nodeSel

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0)

      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      simulation.stop()
      svg.on('.zoom', null)
      svg.selectAll('*').remove()
      nodeSelRef.current = null
    }
  }, [graph])

  // Update node highlight visuals without touching the simulation or zoom state.
  useEffect(() => {
    const nodeSel = nodeSelRef.current
    if (!nodeSel) return
    nodeSel.select<SVGCircleElement>('circle')
      .attr('r', (d) => (d.id === activePageId ? 8 : 5))
      .attr('stroke', (d) => (d.id === activePageId ? '#0f0f0f' : '#ffffff'))
      .attr('stroke-width', (d) => (d.id === activePageId ? 2 : 1))
      
    nodeSel.select<SVGTextElement>('text')
      .attr('fill', (d) => (d.id === activePageId ? '#0f0f0f' : '#5a5a56'))
  }, [activePageId])

  if (graph.nodes.length === 0) {
    return (
      <div
        className="flex h-72 items-center justify-center rounded-lg border border-neutral-200"
        style={{ background: '#fafaf8' }}
      >
        <p className="text-xs text-neutral-600">No pages yet</p>
      </div>
    )
  }

  return (
    <div className="h-72 overflow-hidden rounded-lg border border-neutral-200" style={{ background: '#fafaf8' }}>
      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  )
}
