import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";
import "./CSS/styles.css";
import BannerCard from "./BannerCard";
import SectionTittle from "../../Shared/SectionTittle/SectionTittle";
import useApprovedAds from "../../../hooks/useApprovedAds";

const Ads = () => {
  const [approvedAds] = useApprovedAds();
  
  return (
    <div className="mb-14">
      <SectionTittle title={"Top Products"} />
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
          {approvedAds.map((product) => (
            <SwiperSlide key={product._id}>
              <BannerCard product={product} />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </div>
  );
};

export default Ads;
