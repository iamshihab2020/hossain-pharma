import SectionTittle from "../../../Shared/SectionTittle/SectionTittle";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";
import "./CSS/styles.css";
import LatestProductCards from "../LatestProductsCards/LatestProductsCards";
import useProduct from "../../../../hooks/useProduct";

const LatestProducts = () => {
  const [products] = useProduct();
  const maxProducts = 8;

  return (
    <div className="mb-14">
      <SectionTittle title={"Latest Products"} />
      <div className="-mt-14">
        <Swiper
          slidesPerView={1}
          spaceBetween={10}
          pagination={{
            clickable: true,
          }}
          breakpoints={{
            "@0.00": {
              slidesPerView: 1,
              spaceBetween: 10,
            },
            "@0.75": {
              slidesPerView: 2,
              spaceBetween: 20,
            },
            "@1.00": {
              slidesPerView: 3,
              spaceBetween: 40,
            },
            "@1.50": {
              slidesPerView: 4,
              spaceBetween: 50,
            },
          }}
          modules={[Pagination]}
          className="mySwiper p-20"
        >
          {products.slice(0, maxProducts).map((product) => (
            <SwiperSlide key={product._id}>
              <LatestProductCards product={product} />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </div>
  );
};

export default LatestProducts;
