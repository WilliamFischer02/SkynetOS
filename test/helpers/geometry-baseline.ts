/**
 * What the geometry tests import, in one place: the real geometry, plus the constant the OLD curl
 * estimator divided by — kept only so a test can recompute that estimator and show its bias.
 */

export { closure, handGeometry } from '../../packages/shared/hand-geometry.js';

/** A full fist summed over MCP, PIP and DIP: what the angle-sum estimator of 2026-09-12 divided by. */
export const FULL_FINGER_CURL_ANGLE = (250 * Math.PI) / 180;
