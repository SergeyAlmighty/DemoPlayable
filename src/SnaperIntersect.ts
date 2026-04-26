import {Vector2} from 'three'

/** Коллинеарность / почти параллель — без «магических» чисел в формулах */
const EPS_DENOM = 1e-9

/**
 * Отрезок в 2D (не мутируем переданные Vector2 извне; внутри клонируем при расчётах).
 * KISS: пара точек, без отдельного класса-обёртки.
 */
export interface Segment2D {
  readonly a: Vector2
  readonly b: Vector2
}

/** Результат снапа — отдельный тип, без зависимости от SnaperResult / Three.Line (DIP). */
export interface SnaperIntersectHit {
  readonly snapPos: Vector2
  /** Проекция на отрезок: параметр t ∈ [0,1] по отрезку ab */
  readonly t: number
  readonly distance: number
}

export interface SnaperIntersectCrossHit {
  readonly snapPos: Vector2
  readonly distance: number
}

/** SRP + ISP: только правило «достаточно ли близко». */
export interface SnapDistancePolicy {
  isWithinSnapDistance(distance: number, halfStrokeWidth: number): boolean
}

/** OCP: смена правила — новый класс, SnaperIntersect не меняется. */
export class DefaultSnapDistancePolicy implements SnapDistancePolicy {
  constructor(private readonly extraTolerance: number) {}

  isWithinSnapDistance(distance: number, halfStrokeWidth: number): boolean {
    return distance <= halfStrokeWidth + this.extraTolerance
  }
}

export type ProjectPointOnSegmentResult = SnaperIntersectHit

/**
 * Чистая геометрия (легко тестировать, без состояния).
 * SRP: только проекция точки на отрезок.
 */
export function projectPointOnSegment(point: Vector2, seg: Segment2D): ProjectPointOnSegmentResult {
  const ab = seg.b.clone().sub(seg.a)
  const ap = point.clone().sub(seg.a)
  const abLenSq = ab.dot(ab)
  const tRaw = abLenSq < EPS_DENOM ? 0 : ap.dot(ab) / abLenSq
  const t = Math.min(1, Math.max(0, tRaw))
  const snapPos = seg.a.clone().add(ab.clone().multiplyScalar(t))
  const distance = point.distanceTo(snapPos)
  return {snapPos, t, distance}
}

/**
 * Пересечение двух отрезков в 2D. Параллельные / совпадающие — null (KISS).
 */
export function intersectSegments2D(s1: Segment2D, s2: Segment2D): Vector2 | null {
  const p = s1.a.clone()
  const r = s1.b.clone().sub(s1.a)
  const q = s2.a.clone()
  const sVec = s2.b.clone().sub(s2.a)

  const rxs = cross2(r, sVec)
  const qmp = q.clone().sub(p)
  const qmpxr = cross2(qmp, r)

  if (Math.abs(rxs) < EPS_DENOM) {
    return null
  }

  const t = cross2(qmp, sVec) / rxs
  const u = qmpxr / rxs

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return p.clone().add(r.multiplyScalar(t))
  }
  return null
}

function cross2(u: Vector2, v: Vector2): number {
  return u.x * v.y - u.y * v.x
}

export interface SnaperIntersectOptions {
  readonly policy: SnapDistancePolicy
}

/**
 * Сервис: снап к отрезку и к точке пересечения двух отрезков.
 * DIP: зависит от абстракции SnapDistancePolicy.
 * KISS: два явных метода + агрегатор «ближайший».
 */
export class SnaperIntersect {
  constructor(private readonly options: SnaperIntersectOptions) {}

  get policy(): SnapDistancePolicy {
    return this.options.policy
  }

  /**
   * Снап к ближайшей точке на отрезке, если расстояние укладывается в политику.
   * Аналог логики «проекция на ось стены + допуск по половине ширины».
   */
  snapToSegment(cursor: Vector2, segment: Segment2D, halfStrokeWidth: number): SnaperIntersectHit | null {
    const {snapPos, t, distance} = projectPointOnSegment(cursor, segment)
    if (!this.policy.isWithinSnapDistance(distance, halfStrokeWidth)) {
      return null
    }
    return {snapPos, t, distance}
  }

  /**
   * Если отрезки пересекаются и пересечение близко к курсору — снап в узел.
   */
  snapToCrossing(
    cursor: Vector2,
    primary: Segment2D,
    secondary: Segment2D,
    halfStrokeWidth: number,
  ): SnaperIntersectCrossHit | null {
    const cross = intersectSegments2D(primary, secondary)
    if (!cross) {
      return null
    }
    const distance = cursor.distanceTo(cross)
    if (!this.policy.isWithinSnapDistance(distance, halfStrokeWidth)) {
      return null
    }
    return {snapPos: cross, distance}
  }

  /**
   * Возвращает более близкий к курсору вариант: пересечение или проекция на primary.
   * DRY: переиспользует два метода выше.
   */
  snapToSegmentOrCrossing(
    cursor: Vector2,
    primary: Segment2D,
    secondary: Segment2D | null,
    halfStrokeWidth: number,
  ): SnaperIntersectHit | SnaperIntersectCrossHit | null {
    const onSeg = this.snapToSegment(cursor, primary, halfStrokeWidth)
    if (!secondary) {
      return onSeg
    }
    const onCross = this.snapToCrossing(cursor, primary, secondary, halfStrokeWidth)
    if (!onSeg && !onCross) {
      return null
    }
    if (!onCross) {
      return onSeg
    }
    if (!onSeg) {
      return onCross
    }
    return onSeg.distance <= onCross.distance ? onSeg : onCross
  }
}
