import { drawPet, speciesNames } from '../../core/sprites.ts';
import type { Color } from '../../core/profiles.ts';

/** The profile's pixel pet drawn as SVG, or its initials when it has no pet. */
export function PetAvatar(props: { pet: string; color: Color; icon: string; className?: string }) {
  const species = speciesNames.indexOf(props.pet);
  const className = `avatar ${props.color} ${props.className ?? ''}`;
  if (species < 0) return <span className={className}>{props.icon}</span>;
  // One path per colour keeps the SVG small: 'M x y h1 v1 h-1 z' per pixel.
  const paths = new Map<string, string>();
  for (const [y, row] of drawPet(species, props.color, 'idle', 0).entries())
    for (const [x, [r, g, b, a]] of row.entries())
      if (a) paths.set(`rgb(${r} ${g} ${b})`, `${paths.get(`rgb(${r} ${g} ${b})`) ?? ''}M${x} ${y}h1v1h-1z`);
  return (
    <span className={`${className} pet-avatar`} role="img" aria-label={props.pet}>
      <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
        {[...paths].map(([fill, d]) => (
          <path key={fill} fill={fill} d={d} />
        ))}
      </svg>
    </span>
  );
}
